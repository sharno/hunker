module Hunker.Domain.Repository exposing
    ( Branch
    , Checkout(..)
    , Commit
    , Commits
    , File
    , FileContent
    , PullRequest
    , PullRequestsPage
    , RemoteState(..)
    , Repository
    , RepositoryCatalog
    , SearchMatch
    , SearchResults
    , SourceControlStatus
    , catalogDecoder
    , cloneDecoder
    , commitsDecoder
    , fileContentDecoder
    , filesDecoder
    , pullRequestsDecoder
    , pulledDecoder
    , searchDecoder
    , sourceControlDecoder
    , switchedDecoder
    )

import Json.Decode as Decode exposing (Decoder)


type alias Repository =
    { owner : String
    , name : String
    , path : String
    , source : String
    }


type alias RepositoryCatalog =
    { configuredRoot : String
    , temporaryRoot : String
    , repositories : List Repository
    }


type alias File =
    { path : String
    , size : Int
    , gitStatus : String
    }


type alias FileContent =
    { path : String
    , content : String
    , truncated : Bool
    }


type alias SearchMatch =
    { path : String
    , line : Int
    , column : Int
    , lineContent : String
    , contextBefore : List String
    , contextAfter : List String
    , ranges : List ( Int, Int )
    , definition : Bool
    }


type alias SearchResults =
    { files : List File
    , matches : List SearchMatch
    }


type alias Commit =
    { sha : String
    , parents : List String
    , authorName : String
    , authorEmail : String
    , authoredAt : String
    , subject : String
    }


type alias Commits =
    { ref : String
    , shallow : Bool
    , commits : List Commit
    }


type alias PullRequest =
    { number : Int
    , title : String
    , author : String
    , avatarUrl : String
    , state : String
    , draft : Bool
    , updatedAt : String
    , base : String
    , head : String
    , labels : List String
    }


type alias PullRequestsPage =
    { state : String
    , page : Int
    , hasMore : Bool
    , pullRequests : List PullRequest
    }


type alias Branch =
    { name : String
    , local : Bool
    , remote : Bool
    }


type Checkout
    = TrackingBranch { name : String, oid : String, upstream : String, ahead : Int, behind : Int }
    | UntrackedBranch { name : String, oid : String }
    | DetachedHead { oid : String }


type RemoteState
    = RemoteCurrent Int
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
        (Decode.field "source" Decode.string)


filesDecoder : Decoder (List File)
filesDecoder =
    Decode.field "files" (Decode.list fileDecoder)


fileDecoder : Decoder File
fileDecoder =
    Decode.map3 File
        (Decode.field "path" Decode.string)
        (Decode.field "size" Decode.int)
        (Decode.field "gitStatus" Decode.string)


fileContentDecoder : Decoder FileContent
fileContentDecoder =
    Decode.map3 FileContent
        (Decode.field "path" Decode.string)
        (Decode.field "content" Decode.string)
        (Decode.field "truncated" Decode.bool)


searchDecoder : Decoder SearchResults
searchDecoder =
    Decode.map2 SearchResults
        (Decode.field "files" (Decode.list fileDecoder))
        (Decode.field "matches" (Decode.list searchMatchDecoder))


searchMatchDecoder : Decoder SearchMatch
searchMatchDecoder =
    Decode.map8 SearchMatch
        (Decode.field "path" Decode.string)
        (Decode.field "line" Decode.int)
        (Decode.field "column" Decode.int)
        (Decode.field "lineContent" Decode.string)
        (Decode.field "contextBefore" (Decode.list Decode.string))
        (Decode.field "contextAfter" (Decode.list Decode.string))
        (Decode.field "ranges" (Decode.list pairDecoder))
        (Decode.field "definition" Decode.bool)


pairDecoder : Decoder ( Int, Int )
pairDecoder =
    Decode.map2 Tuple.pair
        (Decode.index 0 Decode.int)
        (Decode.index 1 Decode.int)


commitsDecoder : Decoder Commits
commitsDecoder =
    Decode.map3 Commits
        (Decode.field "ref" Decode.string)
        (Decode.field "shallow" Decode.bool)
        (Decode.field "commits" (Decode.list commitDecoder))


commitDecoder : Decoder Commit
commitDecoder =
    Decode.map6 Commit
        (Decode.field "sha" Decode.string)
        (Decode.field "parents" (Decode.list Decode.string))
        (Decode.field "authorName" Decode.string)
        (Decode.field "authorEmail" Decode.string)
        (Decode.field "authoredAt" Decode.string)
        (Decode.field "subject" Decode.string)


pullRequestsDecoder : Decoder PullRequestsPage
pullRequestsDecoder =
    Decode.map4 PullRequestsPage
        (Decode.field "state" Decode.string)
        (Decode.field "page" Decode.int)
        (Decode.field "hasMore" Decode.bool)
        (Decode.field "pullRequests" (Decode.list pullRequestDecoder))


pullRequestDecoder : Decoder PullRequest
pullRequestDecoder =
    Decode.map8
        (\number title author avatarUrl state draft updatedAt base ->
            { number = number
            , title = title
            , author = author
            , avatarUrl = avatarUrl
            , state = state
            , draft = draft
            , updatedAt = updatedAt
            , base = base
            , head = ""
            , labels = []
            }
        )
        (Decode.field "number" Decode.int)
        (Decode.field "title" Decode.string)
        (Decode.field "author" Decode.string)
        (Decode.field "avatarUrl" Decode.string)
        (Decode.field "state" Decode.string)
        (Decode.field "draft" Decode.bool)
        (Decode.field "updatedAt" Decode.string)
        (Decode.field "base" Decode.string)
        |> Decode.andThen
            (\partial ->
                Decode.map2
                    (\head labels -> { partial | head = head, labels = labels })
                    (Decode.field "head" Decode.string)
                    (Decode.field "labels" (Decode.list Decode.string))
            )


sourceControlDecoder : Decoder SourceControlStatus
sourceControlDecoder =
    Decode.field "status" sourceControlStatusDecoder


switchedDecoder : Decoder SourceControlStatus
switchedDecoder =
    sourceControlDecoder


pulledDecoder : Decoder ( SourceControlStatus, Int )
pulledDecoder =
    Decode.map2 Tuple.pair
        (Decode.field "status" sourceControlStatusDecoder)
        (Decode.field "pulledCommits" Decode.int)


cloneDecoder : Decoder String
cloneDecoder =
    Decode.field "path" Decode.string


sourceControlStatusDecoder : Decoder SourceControlStatus
sourceControlStatusDecoder =
    Decode.map7
        (\path checkout branches staged unstaged untracked remote ->
            { path = path
            , checkout = checkout
            , branches = branches
            , staged = staged
            , unstaged = unstaged
            , untracked = untracked
            , remote = remote
            }
        )
        (Decode.field "path" Decode.string)
        (Decode.field "checkout" checkoutDecoder)
        (Decode.field "branches" (Decode.list branchDecoder))
        (Decode.at [ "changes", "staged" ] Decode.int)
        (Decode.at [ "changes", "unstaged" ] Decode.int)
        (Decode.at [ "changes", "untracked" ] Decode.int)
        (Decode.field "remote" remoteDecoder)


branchDecoder : Decoder Branch
branchDecoder =
    Decode.map3 Branch
        (Decode.field "name" Decode.string)
        (Decode.field "local" Decode.bool)
        (Decode.field "remote" Decode.bool)


checkoutDecoder : Decoder Checkout
checkoutDecoder =
    Decode.field "_tag" Decode.string
        |> Decode.andThen
            (\tag ->
                case tag of
                    "TrackingBranch" ->
                        Decode.map5
                            (\name oid upstream ahead behind ->
                                TrackingBranch
                                    { name = name
                                    , oid = oid
                                    , upstream = upstream
                                    , ahead = ahead
                                    , behind = behind
                                    }
                            )
                            (Decode.field "name" Decode.string)
                            (Decode.field "oid" Decode.string)
                            (Decode.field "upstream" Decode.string)
                            (Decode.field "ahead" Decode.int)
                            (Decode.field "behind" Decode.int)

                    "UntrackedBranch" ->
                        Decode.map2 (\name oid -> UntrackedBranch { name = name, oid = oid })
                            (Decode.field "name" Decode.string)
                            (Decode.field "oid" Decode.string)

                    "DetachedHead" ->
                        Decode.map (\oid -> DetachedHead { oid = oid })
                            (Decode.field "oid" Decode.string)

                    _ ->
                        Decode.fail ("Unknown checkout state: " ++ tag)
            )


remoteDecoder : Decoder RemoteState
remoteDecoder =
    Decode.field "_tag" Decode.string
        |> Decode.andThen
            (\tag ->
                case tag of
                    "RemoteCurrent" ->
                        Decode.map RemoteCurrent (Decode.field "checkedAt" Decode.int)

                    "RemoteUnavailable" ->
                        Decode.map2 RemoteUnavailable
                            (Decode.field "checkedAt" Decode.int)
                            (Decode.field "error" Decode.string)

                    _ ->
                        Decode.fail ("Unknown remote state: " ++ tag)
            )
