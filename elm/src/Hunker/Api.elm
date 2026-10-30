module Hunker.Api exposing
    ( FileRequest
    , InlineComment
    , checkRevision
    , cloneRepository
    , fetchAnalysis
    , fetchCommits
    , fetchFullFile
    , fetchRepositoryCommits
    , fetchRepositoryFile
    , fetchRepositoryFiles
    , fetchRepositoryPulls
    , fetchReview
    , fetchReviewComments
    , listRepositories
    , loadSettings
    , postInlineComment
    , postReply
    , pullRepository
    , refreshSourceControl
    , saveSettings
    , searchRepository
    , submitReview
    , switchBranch
    )

import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Git as Git exposing (BranchName, Oid, RepositoryId)
import Hunker.Domain.Repository as Repository exposing (PullRequestState, RepositoryRoot, SearchMode)
import Hunker.Domain.Review as Review exposing (CommentSide, ReviewAction, ReviewRevision)
import Hunker.Domain.Settings as Settings exposing (AnalysisOptions, Feature(..), Whitespace(..))
import Hunker.Effect as Effect exposing (Effect, Method(..))
import Hunker.Repository.Revision as Revision exposing (Revision)
import Hunker.Route as Route exposing (PullRequestRef)
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode
import Url.Builder exposing (QueryParameter, string)


get : List String -> List QueryParameter -> Decoder a -> (a -> msg) -> (ApiError -> msg) -> Effect msg
get path query decoder succeeded failed =
    Effect.get (Url.Builder.absolute ("api" :: path) query) (Decode.map succeeded decoder) failed


send : Method -> List String -> List ( String, Encode.Value ) -> Decoder a -> (a -> msg) -> (ApiError -> msg) -> Effect msg
send method path body decoder succeeded failed =
    Effect.send method (Url.Builder.absolute ("api" :: path) []) (Encode.object body) (Decode.map succeeded decoder) failed


repositoryParameter : RepositoryId -> QueryParameter
repositoryParameter repository =
    string "repository" (Git.repositoryToString repository)


revisionParameters : Revision -> List QueryParameter
revisionParameters revision =
    [ repositoryParameter (Revision.repository revision)
    , string "oid" (Git.oidToString (Revision.oid revision))
    ]


pullParameter : PullRequestRef -> QueryParameter
pullParameter pull =
    string "url" (Route.pullRequestUrl pull)



-- SETTINGS


loadSettings : (Settings.SettingsDocument -> msg) -> (ApiError -> msg) -> Effect msg
loadSettings =
    get [ "settings" ] [] Settings.documentDecoder


saveSettings : Settings.Settings -> (Settings.SettingsDocument -> msg) -> (ApiError -> msg) -> Effect msg
saveSettings settings =
    send Put [ "settings" ] [ ( "settings", Settings.encode settings ) ] Settings.documentDecoder



-- REPOSITORIES


listRepositories : (Repository.RepositoryCatalog -> msg) -> (ApiError -> msg) -> Effect msg
listRepositories =
    get [ "repositories" ] [] Repository.catalogDecoder


fetchRepositoryFiles : Revision -> (List Repository.File -> msg) -> (ApiError -> msg) -> Effect msg
fetchRepositoryFiles revision =
    get [ "repository", "files" ] (revisionParameters revision) Repository.filesDecoder


fetchRepositoryCommits : Revision -> (Repository.Commits -> msg) -> (ApiError -> msg) -> Effect msg
fetchRepositoryCommits revision =
    get [ "repository", "commits" ] (revisionParameters revision) Repository.commitsDecoder


fetchRepositoryPulls : RepositoryId -> PullRequestState -> Int -> (Repository.PullRequestsPage -> msg) -> (ApiError -> msg) -> Effect msg
fetchRepositoryPulls repository state page =
    get [ "repository", "pulls" ]
        [ repositoryParameter repository
        , string "state" (Repository.pullRequestStateToString state)
        , Url.Builder.int "page" page
        ]
        Repository.pullRequestsDecoder


searchRepository : Revision -> String -> SearchMode -> (Repository.SearchResults -> msg) -> (ApiError -> msg) -> Effect msg
searchRepository revision query mode =
    get [ "repository", "search" ]
        (revisionParameters revision ++ [ string "query" query, string "mode" (Repository.searchModeToString mode) ])
        Repository.searchDecoder


fetchRepositoryFile : Revision -> String -> (Repository.FileContent -> msg) -> (ApiError -> msg) -> Effect msg
fetchRepositoryFile revision path =
    get [ "repository", "file" ] (revisionParameters revision ++ [ string "path" path ]) Repository.fileContentDecoder


cloneRepository : RepositoryId -> RepositoryRoot -> (String -> msg) -> (ApiError -> msg) -> Effect msg
cloneRepository repository destination =
    send Post
        [ "repository", "clone" ]
        [ ( "repository", Encode.string (Git.repositoryToString repository) )
        , ( "destination", Encode.string (Repository.repositoryRootToString destination) )
        ]
        Repository.cloneDecoder


refreshSourceControl : RepositoryId -> (Repository.SourceControlStatus -> msg) -> (ApiError -> msg) -> Effect msg
refreshSourceControl repository =
    get [ "repository", "source-control" ] [ repositoryParameter repository ] Repository.sourceControlDecoder


switchBranch : RepositoryId -> BranchName -> (Repository.SourceControlStatus -> msg) -> (ApiError -> msg) -> Effect msg
switchBranch repository branch =
    send Post
        [ "repository", "branch" ]
        [ ( "repository", Encode.string (Git.repositoryToString repository) )
        , ( "branch", Encode.string (Git.branchToString branch) )
        ]
        Repository.sourceControlDecoder


pullRepository : RepositoryId -> (Int -> msg) -> (ApiError -> msg) -> Effect msg
pullRepository repository =
    send Post [ "repository", "pull" ] [ ( "repository", Encode.string (Git.repositoryToString repository) ) ] Repository.pulledDecoder



-- REVIEWS


fetchReview : String -> (Review.ReviewDocument -> msg) -> (ApiError -> msg) -> Effect msg
fetchReview diffUrl =
    get [ "diff" ] [ string "url" diffUrl ] Review.reviewDecoder


fetchCommits : PullRequestRef -> (List Review.PullCommit -> msg) -> (ApiError -> msg) -> Effect msg
fetchCommits pull =
    get [ "commits" ] [ pullParameter pull ] Review.commitsDecoder


checkRevision : PullRequestRef -> Oid -> (Review.Revision -> msg) -> (ApiError -> msg) -> Effect msg
checkRevision pull headOid =
    get [ "revision" ] [ pullParameter pull, string "headOid" (Git.oidToString headOid) ] Review.revisionDecoder


type alias FileRequest =
    { diffUrl : String
    , revision : ReviewRevision
    , path : String
    }


revisionQuery : String -> ReviewRevision -> List QueryParameter
revisionQuery diffUrl revision =
    [ string "url" diffUrl
    , string "baseOid" (Git.oidToString revision.baseOid)
    , string "headOid" (Git.oidToString revision.headOid)
    ]


fetchFullFile : FileRequest -> (Review.FullFile -> msg) -> (ApiError -> msg) -> Effect msg
fetchFullFile request =
    get [ "file" ] (revisionQuery request.diffUrl request.revision ++ [ string "path" request.path ]) Review.fullFileDecoder


fetchAnalysis : String -> ReviewRevision -> AnalysisOptions -> (Review.AnalysisSnapshot -> msg) -> (ApiError -> msg) -> Effect msg
fetchAnalysis diffUrl revision options =
    let
        feature value =
            case value of
                Enabled ->
                    "enabled"

                Disabled ->
                    "disabled"
    in
    get [ "analysis" ]
        (revisionQuery diffUrl revision
            ++ [ string "whitespace"
                    (case options.whitespace of
                        IgnoreWhitespace ->
                            "ignore"

                        ShowWhitespace ->
                            "show"
                    )
               , string "semantic" (feature options.semantic)
               , string "syntax" (feature options.syntax)
               , string "inlineDiff" (Settings.inlineDiffModeToString options.inlineDiff)
               ]
        )
        Review.analysisSnapshotDecoder


fetchReviewComments : PullRequestRef -> (List Review.ReviewComment -> msg) -> (ApiError -> msg) -> Effect msg
fetchReviewComments pull =
    get [ "reviews" ] [ pullParameter pull ] Review.commentsDecoder


type alias InlineComment =
    { pull : PullRequestRef
    , commitId : Oid
    , path : String
    , line : Int
    , side : CommentSide
    , body : String
    }


postInlineComment : InlineComment -> (Review.ReviewComment -> msg) -> (ApiError -> msg) -> Effect msg
postInlineComment comment =
    send Post
        [ "reviews", "comment" ]
        [ ( "pullUrl", Encode.string (Route.pullRequestUrl comment.pull) )
        , ( "commitId", Encode.string (Git.oidToString comment.commitId) )
        , ( "path", Encode.string comment.path )
        , ( "line", Encode.int comment.line )
        , ( "side", Encode.string (Review.commentSideToString comment.side) )
        , ( "body", Encode.string comment.body )
        ]
        (Decode.field "comment" Review.commentDecoder)


postReply : PullRequestRef -> Int -> String -> (Review.ReviewComment -> msg) -> (ApiError -> msg) -> Effect msg
postReply pull commentId body =
    send Post
        [ "reviews", "reply" ]
        [ ( "url", Encode.string (Route.pullRequestUrl pull) )
        , ( "commentId", Encode.int commentId )
        , ( "body", Encode.string body )
        ]
        (Decode.field "comment" Review.commentDecoder)


submitReview : PullRequestRef -> String -> ReviewAction -> (ReviewAction -> msg) -> (ApiError -> msg) -> Effect msg
submitReview pull body action =
    send Post
        [ "reviews", "submit" ]
        [ ( "url", Encode.string (Route.pullRequestUrl pull) )
        , ( "body", Encode.string body )
        , ( "event", Encode.string (Review.reviewActionToString action) )
        ]
        (Decode.field "event" Review.reviewActionDecoder)
