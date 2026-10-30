module Hunker.Domain.Repository exposing
    ( Branch
    , BranchPresence(..)
    , Checkout(..)
    , Commit
    , Commits
    , File
    , FileContent
    , History(..)
    , PullRequest
    , PullRequestState(..)
    , PullRequestStatus(..)
    , PullRequestsPage
    , RemoteState(..)
    , Repository
    , RepositoryCatalog
    , RepositoryRoot(..)
    , SearchMatch
    , SearchMode(..)
    , SearchResults
    , SourceControlStatus
    , catalogDecoder
    , checkoutBranch
    , checkoutOid
    , cloneDecoder
    , commitsDecoder
    , fileContentDecoder
    , filesDecoder
    , pullRequestStateFromString
    , pullRequestStateToString
    , pullRequestsDecoder
    , pulledDecoder
    , repositoryRootToString
    , searchDecoder
    , searchModeFromString
    , searchModeToString
    , sourceControlDecoder
    )

import Hunker.Decode exposing (andMap)
import Hunker.Domain.Git as Git exposing (BranchName, Oid)
import Hunker.Domain.Source as Source exposing (Presentation)
import Json.Decode as Decode exposing (Decoder)
import Time


type RepositoryRoot
    = Configured
    | Temporary


type alias Repository =
    { owner : String
    , name : String
    , path : String
    , source : RepositoryRoot
    }


type alias RepositoryCatalog =
    { configuredRoot : String
    , temporaryRoot : String
    , repositories : List Repository
    }


type alias File =
    { path : String
    , size : Int
    }


type alias FileContent =
    { path : String
    , content : String
    , truncated : Bool
    , presentation : Presentation
    }


type alias SearchMatch =
    { path : String
    , line : Int
    , column : Int
    , lineContent : String
    , contextBefore : List String
    , contextAfter : List String
    , ranges : List ( Int, Int )
    }


type alias SearchResults =
    { files : List File
    , matches : List SearchMatch
    }


type SearchMode
    = LiteralSearch
    | RegexSearch
    | FuzzySearch


type alias Commit =
    { sha : Oid
    , parents : List Oid
    , authorName : String
    , authorEmail : String
    , authoredAt : Time.Posix
    , subject : String
    }


type History
    = ShallowHistory
    | CompleteHistory


type alias Commits =
    { ref : Oid
    , history : History
    , commits : List Commit
    }


type PullRequestState
    = OpenPulls
    | ClosedPulls
    | AllPulls


type PullRequestStatus
    = DraftPull
    | OpenPull
    | MergedPull
    | ClosedPull


type alias PullRequest =
    { number : Int
    , title : String
    , author : String
    , avatarUrl : Maybe String
    , status : PullRequestStatus
    , updatedAt : Time.Posix
    , base : String
    , head : String
    , labels : List String
    }


type alias PullRequestsPage =
    { state : PullRequestState
    , page : Int
    , hasMore : Bool
    , pullRequests : List PullRequest
    }


type BranchPresence
    = LocalBranch
    | RemoteBranch
    | LocalAndRemoteBranch


type alias Branch =
    { name : BranchName
    , presence : BranchPresence
    }


type Checkout
    = TrackingBranch { name : BranchName, oid : Oid, upstream : String, ahead : Int, behind : Int }
    | UntrackedBranch { name : BranchName, oid : Oid }
    | DetachedHead { oid : Oid }


{-| A status read from local Git alone has not checked the remote yet.
-}
type RemoteState
    = RemoteNotChecked
    | RemoteCurrent Int
    | RemoteUnavailable Int String


type alias SourceControlStatus =
    { path : String
    , checkout : Checkout
    , branches : List Branch
    , staged : Int
    , unstaged : Int
    , untracked : Int
    , remote : RemoteState
    }


checkoutOid : Checkout -> Oid
checkoutOid checkout =
    case checkout of
        TrackingBranch branch ->
            branch.oid

        UntrackedBranch branch ->
            branch.oid

        DetachedHead head ->
            head.oid


checkoutBranch : Checkout -> Maybe BranchName
checkoutBranch checkout =
    case checkout of
        TrackingBranch branch ->
            Just branch.name

        UntrackedBranch branch ->
            Just branch.name

        DetachedHead _ ->
            Nothing


repositoryRoots : List ( String, RepositoryRoot )
repositoryRoots =
    [ ( "configured", Configured ), ( "temporary", Temporary ) ]


repositoryRootToString : RepositoryRoot -> String
repositoryRootToString root =
    case root of
        Configured ->
            "configured"

        Temporary ->
            "temporary"


searchModes : List ( String, SearchMode )
searchModes =
    [ ( "literal", LiteralSearch ), ( "regex", RegexSearch ), ( "fuzzy", FuzzySearch ) ]


searchModeToString : SearchMode -> String
searchModeToString mode =
    case mode of
        LiteralSearch ->
            "literal"

        RegexSearch ->
            "regex"

        FuzzySearch ->
            "fuzzy"


searchModeFromString : String -> Maybe SearchMode
searchModeFromString value =
    fromTable value searchModes


pullRequestStates : List ( String, PullRequestState )
pullRequestStates =
    [ ( "open", OpenPulls ), ( "closed", ClosedPulls ), ( "all", AllPulls ) ]


pullRequestStateToString : PullRequestState -> String
pullRequestStateToString state =
    case state of
        OpenPulls ->
            "open"

        ClosedPulls ->
            "closed"

        AllPulls ->
            "all"


pullRequestStateFromString : String -> Maybe PullRequestState
pullRequestStateFromString value =
    fromTable value pullRequestStates


fromTable : String -> List ( String, a ) -> Maybe a
fromTable key table =
    table
        |> List.filter (Tuple.first >> (==) key)
        |> List.head
        |> Maybe.map Tuple.second


catalogDecoder : Decoder RepositoryCatalog
catalogDecoder =
    Decode.map3 RepositoryCatalog
        (Decode.field "configuredRoot" Decode.string)
        (Decode.field "temporaryRoot" Decode.string)
        (Decode.field "repositories" (Decode.list repositoryDecoder))


repositoryDecoder : Decoder Repository
repositoryDecoder =
    Decode.map4 Repository
        (Decode.field "owner" Decode.string)
        (Decode.field "name" Decode.string)
        (Decode.field "path" Decode.string)
        (Decode.field "source" (Hunker.Decode.enum "repository root" repositoryRoots))


filesDecoder : Decoder (List File)
filesDecoder =
    Decode.field "files" (Decode.list fileDecoder)


fileDecoder : Decoder File
fileDecoder =
    Decode.map2 File
        (Decode.field "path" Decode.string)
        (Decode.field "size" Decode.int)


fileContentDecoder : Decoder FileContent
fileContentDecoder =
    Decode.map4 FileContent
        (Decode.field "path" Decode.string)
        (Decode.field "content" Decode.string)
        (Decode.field "truncated" Decode.bool)
        (Decode.field "presentation" Source.decoder)


searchDecoder : Decoder SearchResults
searchDecoder =
    Decode.map2 SearchResults
        (Decode.field "files" (Decode.list fileDecoder))
        (Decode.field "matches" (Decode.list searchMatchDecoder))


searchMatchDecoder : Decoder SearchMatch
searchMatchDecoder =
    Decode.map7 SearchMatch
        (Decode.field "path" Decode.string)
        (Decode.field "line" Decode.int)
        (Decode.field "column" Decode.int)
        (Decode.field "lineContent" Decode.string)
        (Decode.field "contextBefore" (Decode.list Decode.string))
        (Decode.field "contextAfter" (Decode.list Decode.string))
        (Decode.field "ranges" (Decode.list pairDecoder))


pairDecoder : Decoder ( Int, Int )
pairDecoder =
    Decode.map2 Tuple.pair
        (Decode.index 0 Decode.int)
        (Decode.index 1 Decode.int)


commitsDecoder : Decoder Commits
commitsDecoder =
    Decode.map3 Commits
        (Decode.field "ref" Git.oidDecoder)
        (Decode.field "history" (Hunker.Decode.enum "history" [ ( "shallow", ShallowHistory ), ( "complete", CompleteHistory ) ]))
        (Decode.field "commits" (Decode.list commitDecoder))


commitDecoder : Decoder Commit
commitDecoder =
    Decode.map6 Commit
        (Decode.field "sha" Git.oidDecoder)
        (Decode.field "parents" (Decode.list Git.oidDecoder))
        (Decode.field "authorName" Decode.string)
        (Decode.field "authorEmail" Decode.string)
        (Decode.field "authoredAt" Hunker.Decode.posix)
        (Decode.field "subject" Decode.string)


pullRequestsDecoder : Decoder PullRequestsPage
pullRequestsDecoder =
    Decode.map4 PullRequestsPage
        (Decode.field "state" (Hunker.Decode.enum "pull request state" pullRequestStates))
        (Decode.field "page" Decode.int)
        (Decode.field "hasMore" Decode.bool)
        (Decode.field "pullRequests" (Decode.list pullRequestDecoder))


pullRequestDecoder : Decoder PullRequest
pullRequestDecoder =
    Decode.succeed PullRequest
        |> andMap (Decode.field "number" Decode.int)
        |> andMap (Decode.field "title" Decode.string)
        |> andMap (Decode.field "author" Decode.string)
        |> andMap (Decode.field "avatarUrl" (Decode.nullable Decode.string))
        |> andMap
            (Decode.field "status"
                (Hunker.Decode.enum "pull request status"
                    [ ( "draft", DraftPull ), ( "open", OpenPull ), ( "merged", MergedPull ), ( "closed", ClosedPull ) ]
                )
            )
        |> andMap (Decode.field "updatedAt" Hunker.Decode.posix)
        |> andMap (Decode.field "base" Decode.string)
        |> andMap (Decode.field "head" Decode.string)
        |> andMap (Decode.field "labels" (Decode.list Decode.string))


sourceControlDecoder : Decoder SourceControlStatus
sourceControlDecoder =
    Decode.field "status" sourceControlStatusDecoder


pulledDecoder : Decoder Int
pulledDecoder =
    Decode.field "pulledCommits" Decode.int


cloneDecoder : Decoder String
cloneDecoder =
    Decode.field "path" Decode.string


sourceControlStatusDecoder : Decoder SourceControlStatus
sourceControlStatusDecoder =
    Decode.map7 SourceControlStatus
        (Decode.field "path" Decode.string)
        (Decode.field "checkout" checkoutDecoder)
        (Decode.field "branches" (Decode.list branchDecoder))
        (Decode.at [ "changes", "staged" ] Decode.int)
        (Decode.at [ "changes", "unstaged" ] Decode.int)
        (Decode.at [ "changes", "untracked" ] Decode.int)
        (Decode.field "remote" remoteDecoder)


branchDecoder : Decoder Branch
branchDecoder =
    Decode.map2 Branch
        (Decode.field "name" Git.branchDecoder)
        (Decode.field "presence"
            (Hunker.Decode.enum "branch presence"
                [ ( "local", LocalBranch ), ( "remote", RemoteBranch ), ( "both", LocalAndRemoteBranch ) ]
            )
        )


checkoutDecoder : Decoder Checkout
checkoutDecoder =
    Hunker.Decode.tagged "_tag"
        "checkout state"
        [ ( "TrackingBranch"
          , Decode.map5
                (\name oid upstream ahead behind ->
                    TrackingBranch { name = name, oid = oid, upstream = upstream, ahead = ahead, behind = behind }
                )
                (Decode.field "name" Git.branchDecoder)
                (Decode.field "oid" Git.oidDecoder)
                (Decode.field "upstream" Decode.string)
                (Decode.field "ahead" Decode.int)
                (Decode.field "behind" Decode.int)
          )
        , ( "UntrackedBranch"
          , Decode.map2 (\name oid -> UntrackedBranch { name = name, oid = oid })
                (Decode.field "name" Git.branchDecoder)
                (Decode.field "oid" Git.oidDecoder)
          )
        , ( "DetachedHead"
          , Decode.map (\oid -> DetachedHead { oid = oid }) (Decode.field "oid" Git.oidDecoder)
          )
        ]


remoteDecoder : Decoder RemoteState
remoteDecoder =
    Hunker.Decode.tagged "_tag"
        "remote state"
        [ ( "NotChecked", Decode.succeed RemoteNotChecked )
        , ( "Current", Decode.map RemoteCurrent (Decode.field "checkedAt" Decode.int) )
        , ( "Unavailable"
          , Decode.map2 RemoteUnavailable
                (Decode.field "checkedAt" Decode.int)
                (Decode.field "error" Decode.string)
          )
        ]
