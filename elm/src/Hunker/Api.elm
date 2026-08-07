module Hunker.Api exposing
    ( checkRevision
    , cloneRepository
    , fetchCharacterDiff
    , fetchCommits
    , fetchFullFile
    , fetchMoves
    , fetchRepositoryCommits
    , fetchRepositoryFile
    , fetchRepositoryFiles
    , fetchRepositoryPulls
    , fetchReview
    , fetchReviewComments
    , fetchSemantic
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

import Http
import Hunker.Domain.Repository as Repository
import Hunker.Domain.Review as Review
import Hunker.Domain.Settings as Settings
import Hunker.Effect as Effect exposing (Effect)
import Json.Decode as Decode
import Json.Encode as Encode
import Url


loadSettings : (Settings.SettingsDocument -> msg) -> (String -> msg) -> Effect msg
loadSettings succeeded failed =
    Effect.get "/api/settings"
        (Decode.map succeeded Settings.documentDecoder)
        failed


listRepositories : (Repository.RepositoryCatalog -> msg) -> (String -> msg) -> Effect msg
listRepositories succeeded failed =
    Effect.get "/api/repositories"
        (Decode.map succeeded Repository.catalogDecoder)
        failed


fetchReview : String -> (Review.ReviewData -> msg) -> (String -> msg) -> Effect msg
fetchReview githubUrl succeeded failed =
    Effect.get
        ("/api/diff?url=" ++ encode githubUrl ++ "&refresh=" ++ encode githubUrl)
        (Decode.map succeeded Review.reviewDecoder)
        failed


fetchCommits : String -> (List Review.PullCommit -> msg) -> (String -> msg) -> Effect msg
fetchCommits githubUrl succeeded failed =
    Effect.get
        ("/api/commits?url=" ++ encode githubUrl)
        (Decode.map succeeded Review.commitsDecoder)
        failed


checkRevision : String -> String -> (Review.Revision -> msg) -> (String -> msg) -> Effect msg
checkRevision githubUrl headOid succeeded failed =
    Effect.get
        ("/api/revision?url=" ++ encode githubUrl ++ "&headOid=" ++ encode headOid)
        (Decode.map succeeded Review.revisionDecoder)
        failed


fetchRepositoryFiles : String -> (List Repository.File -> msg) -> (String -> msg) -> Effect msg
fetchRepositoryFiles repository succeeded failed =
    Effect.get
        ("/api/repository/files?repository=" ++ encode repository)
        (Decode.map succeeded Repository.filesDecoder)
        failed


fetchRepositoryCommits : String -> (Repository.Commits -> msg) -> (String -> msg) -> Effect msg
fetchRepositoryCommits repository succeeded failed =
    Effect.get
        ("/api/repository/commits?repository=" ++ encode repository)
        (Decode.map succeeded Repository.commitsDecoder)
        failed


fetchRepositoryPulls : String -> String -> Int -> (Repository.PullRequestsPage -> msg) -> (String -> msg) -> Effect msg
fetchRepositoryPulls repository state page succeeded failed =
    Effect.get
        ("/api/repository/pulls?repository="
            ++ encode repository
            ++ "&state="
            ++ encode state
            ++ "&page="
            ++ String.fromInt page
        )
        (Decode.map succeeded Repository.pullRequestsDecoder)
        failed


searchRepository : String -> String -> String -> (Repository.SearchResults -> msg) -> (String -> msg) -> Effect msg
searchRepository repository search mode succeeded failed =
    Effect.get
        ("/api/repository/search?repository="
            ++ encode repository
            ++ "&query="
            ++ encode search
            ++ "&mode="
            ++ encode mode
        )
        (Decode.map succeeded Repository.searchDecoder)
        failed


fetchRepositoryFile : String -> String -> (Repository.FileContent -> msg) -> (String -> msg) -> Effect msg
fetchRepositoryFile repository path succeeded failed =
    Effect.get
        ("/api/repository/file?repository=" ++ encode repository ++ "&path=" ++ encode path)
        (Decode.map succeeded Repository.fileContentDecoder)
        failed


cloneRepository : String -> String -> (String -> msg) -> (String -> msg) -> Effect msg
cloneRepository repository destination succeeded failed =
    Effect.send "POST"
        "/api/repository/clone"
        (Http.jsonBody
            (Encode.object
                [ ( "repository", Encode.string repository )
                , ( "destination", Encode.string destination )
                ]
            )
        )
        (Decode.map succeeded Repository.cloneDecoder)
        failed


refreshSourceControl : String -> (Repository.SourceControlStatus -> msg) -> (String -> msg) -> Effect msg
refreshSourceControl repository succeeded failed =
    Effect.get
        ("/api/repository/source-control?repository=" ++ encode repository)
        (Decode.map succeeded Repository.sourceControlDecoder)
        failed


switchBranch : String -> String -> (Repository.SourceControlStatus -> msg) -> (String -> msg) -> Effect msg
switchBranch repository branch succeeded failed =
    Effect.send "POST"
        "/api/repository/branch"
        (Http.jsonBody
            (Encode.object
                [ ( "repository", Encode.string repository )
                , ( "branch", Encode.string branch )
                ]
            )
        )
        (Decode.map succeeded Repository.switchedDecoder)
        failed


pullRepository : String -> (( Repository.SourceControlStatus, Int ) -> msg) -> (String -> msg) -> Effect msg
pullRepository repository succeeded failed =
    Effect.send "POST"
        "/api/repository/pull"
        (Http.jsonBody (Encode.object [ ( "repository", Encode.string repository ) ]))
        (Decode.map succeeded Repository.pulledDecoder)
        failed


saveSettings : Settings.Settings -> (Settings.SettingsDocument -> msg) -> (String -> msg) -> Effect msg
saveSettings settings succeeded failed =
    Effect.send "PUT"
        "/api/settings"
        (Http.jsonBody (Encode.object [ ( "settings", Settings.encode settings ) ]))
        (Decode.map succeeded Settings.documentDecoder)
        failed


fetchSemantic : String -> Review.FileChange -> Review.ReviewBacking -> (Review.SemanticResult -> msg) -> (String -> msg) -> Effect msg
fetchSemantic githubUrl file backing succeeded failed =
    Effect.get
        ("/api/semantic?" ++ fileQuery githubUrl file backing)
        (Decode.map succeeded Review.semanticDecoder)
        failed


fetchFullFile : String -> Review.FileChange -> Review.ReviewBacking -> (Review.FullFile -> msg) -> (String -> msg) -> Effect msg
fetchFullFile githubUrl file backing succeeded failed =
    Effect.get
        ("/api/file?" ++ fileQuery githubUrl file backing)
        (Decode.map succeeded Review.fullFileDecoder)
        failed


fetchCharacterDiff : String -> Review.FileChange -> Review.ReviewBacking -> Bool -> String -> (Review.CharacterDiff -> msg) -> (String -> msg) -> Effect msg
fetchCharacterDiff githubUrl file backing ignoreWhitespace mode succeeded failed =
    Effect.get
        ("/api/characters?"
            ++ fileQuery githubUrl file backing
            ++ "&whitespace="
            ++ (if ignoreWhitespace then
                    "ignore"

                else
                    "show"
               )
            ++ "&mode="
            ++ encode mode
        )
        (Decode.map succeeded Review.characterDiffDecoder)
        failed


fetchMoves : String -> Review.ReviewBacking -> (List Review.MovedBlock -> msg) -> (String -> msg) -> Effect msg
fetchMoves githubUrl backing succeeded failed =
    Effect.get
        ("/api/moves?url="
            ++ encode githubUrl
            ++ "&baseOid="
            ++ encode backing.baseOid
            ++ "&headOid="
            ++ encode backing.headOid
        )
        (Decode.map succeeded Review.movedBlocksDecoder)
        failed


fetchReviewComments : String -> (List Review.ReviewComment -> msg) -> (String -> msg) -> Effect msg
fetchReviewComments githubUrl succeeded failed =
    Effect.get
        ("/api/reviews?url=" ++ encode githubUrl)
        (Decode.map succeeded Review.commentsDecoder)
        failed


postInlineComment : { pullUrl : String, commitId : String, path : String, line : Int, side : String, body : String } -> (Review.ReviewComment -> msg) -> (String -> msg) -> Effect msg
postInlineComment comment succeeded failed =
    Effect.send "POST"
        "/api/reviews/comment"
        (Http.jsonBody
            (Encode.object
                [ ( "pullUrl", Encode.string comment.pullUrl )
                , ( "commitId", Encode.string comment.commitId )
                , ( "path", Encode.string comment.path )
                , ( "line", Encode.int comment.line )
                , ( "side", Encode.string comment.side )
                , ( "body", Encode.string comment.body )
                ]
            )
        )
        (Decode.map succeeded (Decode.field "comment" Review.commentDecoder))
        failed


postReply : String -> Int -> String -> (Review.ReviewComment -> msg) -> (String -> msg) -> Effect msg
postReply githubUrl commentId body succeeded failed =
    Effect.send "POST"
        "/api/reviews/reply"
        (Http.jsonBody
            (Encode.object
                [ ( "url", Encode.string githubUrl )
                , ( "commentId", Encode.int commentId )
                , ( "body", Encode.string body )
                ]
            )
        )
        (Decode.map succeeded (Decode.field "comment" Review.commentDecoder))
        failed


submitReview : String -> String -> String -> (String -> msg) -> (String -> msg) -> Effect msg
submitReview githubUrl body event succeeded failed =
    Effect.send "POST"
        "/api/reviews/submit"
        (Http.jsonBody
            (Encode.object
                [ ( "url", Encode.string githubUrl )
                , ( "body", Encode.string body )
                , ( "event", Encode.string event )
                ]
            )
        )
        (Decode.map succeeded (Decode.field "event" Decode.string))
        failed


fileQuery : String -> Review.FileChange -> Review.ReviewBacking -> String
fileQuery githubUrl file backing =
    [ ( "url", githubUrl )
    , ( "path", file.path )
    , ( "previousPath", file.previousPath )
    , ( "status", file.status )
    , ( "baseOid", backing.baseOid )
    , ( "headOid", backing.headOid )
    ]
        |> List.map (\( key, value ) -> key ++ "=" ++ encode value)
        |> String.join "&"


encode : String -> String
encode =
    Url.percentEncode
