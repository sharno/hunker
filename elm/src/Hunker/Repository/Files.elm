module Hunker.Repository.Files exposing
    ( FileRequest
    , Model
    , Request(..)
    , SearchRequest
    , changeSearchDraft
    , fileFailed
    , fileLoaded
    , fileRequestPath
    , fileRequestRevision
    , init
    , isFolderCollapsed
    , isSourceFoldCollapsed
    , navigate
    , search
    , searchDraft
    , searchDraftMode
    , searchFailed
    , searchLoaded
    , searchRequestMode
    , searchRequestQuery
    , searchRequestRevision
    , selectSearchMode
    , selectedFile
    , toggleFolder
    , toggleSourceFold
    , tree
    )

{-| Browsing one immutable revision: the file tree, the open file, and the
current search. Transitions return the requests they start.
-}

import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Repository exposing (File, FileContent, SearchMode(..), SearchResults)
import Hunker.FileTree as FileTree exposing (Tree)
import Hunker.Remote as Remote exposing (Remote(..))
import Hunker.Repository.Revision exposing (Revision)
import Hunker.Route exposing (Search(..))
import Set exposing (Set)


type Model
    = Model Details


type alias Details =
    { revision : Revision
    , tree : List (Tree File)
    , selectedFile : Remote FileRequest ApiError FileContent
    , search : Remote SearchRequest ApiError SearchResults
    , collapsedFolders : Set String
    , searchDraft : String
    , searchDraftMode : SearchMode
    , collapsedSourceFolds : Set String
    }


type FileRequest
    = FileRequest Revision String


type SearchRequest
    = SearchRequest Revision String SearchMode


type Request
    = OpenFile FileRequest
    | RunSearch SearchRequest


{-| Repository trees start collapsed, except the selected file's ancestors.
-}
init : Revision -> List File -> Maybe String -> Search -> ( Model, List Request )
init revision files path searchLocation =
    let
        forest =
            FileTree.build .path files
    in
    navigate path
        searchLocation
        (Model
            { revision = revision
            , tree = forest
            , selectedFile = NotAsked
            , search = NotAsked
            , collapsedFolders = Set.fromList (FileTree.directoryPaths forest)
            , searchDraft = ""
            , searchDraftMode = LiteralSearch
            , collapsedSourceFolds = Set.empty
            }
        )


{-| Shows the location's file and search, reusing a result that already
answers the same request.
-}
navigate : Maybe String -> Search -> Model -> ( Model, List Request )
navigate path searchLocation (Model details) =
    let
        fileRequest =
            Maybe.map (FileRequest details.revision) path

        searchRequest =
            case searchLocation of
                NoSearch ->
                    Nothing

                Search query mode ->
                    Just (SearchRequest details.revision query mode)

        ( selected, openFile ) =
            reuse fileRequest details.selectedFile OpenFile

        ( searched, runSearch ) =
            reuse searchRequest details.search RunSearch

        ( draft, draftMode ) =
            case searchLocation of
                NoSearch ->
                    ( "", details.searchDraftMode )

                Search query mode ->
                    ( query, mode )
    in
    ( Model
        { details
            | selectedFile = selected
            , search = searched
            , collapsedFolders =
                case path of
                    Just selectedPath ->
                        Set.diff details.collapsedFolders (Set.fromList (FileTree.ancestors selectedPath))

                    Nothing ->
                        details.collapsedFolders
            , searchDraft = draft
            , searchDraftMode = draftMode
        }
    , List.filterMap identity [ openFile, runSearch ]
    )


reuse : Maybe request -> Remote request error value -> (request -> Request) -> ( Remote request error value, Maybe Request )
reuse wanted current toRequest =
    case ( wanted, current ) of
        ( Nothing, _ ) ->
            ( NotAsked, Nothing )

        ( Just request, Success active _ ) ->
            if active == request then
                ( current, Nothing )

            else
                ( Loading request, Just (toRequest request) )

        ( Just request, Loading active ) ->
            if active == request then
                ( current, Nothing )

            else
                ( Loading request, Just (toRequest request) )

        ( Just request, Failure _ _ ) ->
            ( Loading request, Just (toRequest request) )

        ( Just request, NotAsked ) ->
            ( Loading request, Just (toRequest request) )


tree : Model -> List (Tree File)
tree (Model details) =
    details.tree


selectedFile : Model -> Remote FileRequest ApiError FileContent
selectedFile (Model details) =
    details.selectedFile


search : Model -> Remote SearchRequest ApiError SearchResults
search (Model details) =
    details.search


searchDraft : Model -> String
searchDraft (Model details) =
    details.searchDraft


searchDraftMode : Model -> SearchMode
searchDraftMode (Model details) =
    details.searchDraftMode


changeSearchDraft : String -> Model -> Model
changeSearchDraft value (Model details) =
    Model { details | searchDraft = value }


selectSearchMode : SearchMode -> Model -> Model
selectSearchMode value (Model details) =
    Model { details | searchDraftMode = value }


toggleFolder : String -> Model -> Model
toggleFolder path (Model details) =
    Model { details | collapsedFolders = toggleSet path details.collapsedFolders }


isFolderCollapsed : String -> Model -> Bool
isFolderCollapsed path (Model details) =
    Set.member path details.collapsedFolders


toggleSourceFold : String -> Model -> Model
toggleSourceFold fold (Model details) =
    Model { details | collapsedSourceFolds = toggleSet fold details.collapsedSourceFolds }


isSourceFoldCollapsed : String -> Model -> Bool
isSourceFoldCollapsed fold (Model details) =
    Set.member fold details.collapsedSourceFolds


fileLoaded : FileRequest -> FileContent -> Model -> Model
fileLoaded request value (Model details) =
    Model { details | selectedFile = settle request (Success request value) details.selectedFile }


fileFailed : FileRequest -> ApiError -> Model -> Model
fileFailed request error (Model details) =
    Model { details | selectedFile = settle request (Failure request error) details.selectedFile }


searchLoaded : SearchRequest -> SearchResults -> Model -> Model
searchLoaded request value (Model details) =
    Model { details | search = settle request (Success request value) details.search }


searchFailed : SearchRequest -> ApiError -> Model -> Model
searchFailed request error (Model details) =
    Model { details | search = settle request (Failure request error) details.search }


settle : request -> Remote request error value -> Remote request error value -> Remote request error value
settle request result current =
    if current == Remote.Loading request then
        result

    else
        current


fileRequestRevision : FileRequest -> Revision
fileRequestRevision (FileRequest revision _) =
    revision


fileRequestPath : FileRequest -> String
fileRequestPath (FileRequest _ path) =
    path


searchRequestRevision : SearchRequest -> Revision
searchRequestRevision (SearchRequest revision _ _) =
    revision


searchRequestQuery : SearchRequest -> String
searchRequestQuery (SearchRequest _ query _) =
    query


searchRequestMode : SearchRequest -> SearchMode
searchRequestMode (SearchRequest _ _ mode) =
    mode


toggleSet : comparable -> Set comparable -> Set comparable
toggleSet item values =
    if Set.member item values then
        Set.remove item values

    else
        Set.insert item values
