module Hunker.Repository.Files exposing
    ( FileRequest
    , Model
    , SearchRequest
    , catalog
    , changeSearchDraft
    , fileFailed
    , fileLoaded
    , filePath
    , fileRepository
    , init
    , isFolderCollapsed
    , navigate
    , requestSearchMode
    , search
    , searchDraft
    , searchFailed
    , searchLoaded
    , searchMode
    , searchQuery
    , searchRepository
    , selectSearchMode
    , selectedFile
    , toggleFolder
    )

import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Repository exposing (File, FileContent, SearchResults)
import Hunker.FileTree as FileTree
import Hunker.Remote as Remote exposing (Remote(..))
import Hunker.Route exposing (SearchMode)
import Set exposing (Set)


type Model
    = Model Details


type alias Details =
    { repository : String
    , catalog : List File
    , selectedFile : Remote FileRequest ApiError FileContent
    , search : Remote SearchRequest ApiError SearchResults
    , collapsedFolders : Set String
    , searchDraft : String
    , searchMode : SearchMode
    }


type FileRequest
    = FileRequest String String


type SearchRequest
    = SearchRequest String String SearchMode


init : String -> List File -> Maybe String -> String -> SearchMode -> Model
init repository files path query mode =
    Model
        { repository = repository
        , catalog = files
        , selectedFile = selectedRequest repository path
        , search = searchRequest repository query mode
        , collapsedFolders = collapsedFor path files
        , searchDraft = query
        , searchMode = mode
        }


navigate : Maybe String -> String -> SearchMode -> Model -> Model
navigate path query mode (Model details) =
    Model
        { details
            | selectedFile = selectedRequest details.repository path
            , search = searchRequest details.repository query mode
            , collapsedFolders = reveal path details.collapsedFolders
            , searchDraft = query
            , searchMode = mode
        }


catalog : Model -> List File
catalog (Model details) =
    details.catalog


selectedFile : Model -> Remote FileRequest ApiError FileContent
selectedFile (Model details) =
    details.selectedFile


search : Model -> Remote SearchRequest ApiError SearchResults
search (Model details) =
    details.search


searchDraft : Model -> String
searchDraft (Model details) =
    details.searchDraft


searchMode : Model -> SearchMode
searchMode (Model details) =
    details.searchMode


changeSearchDraft : String -> Model -> Model
changeSearchDraft value (Model details) =
    Model { details | searchDraft = value }


selectSearchMode : SearchMode -> Model -> Model
selectSearchMode value (Model details) =
    Model { details | searchMode = value }


toggleFolder : String -> Model -> Model
toggleFolder path (Model details) =
    Model { details | collapsedFolders = toggleSet path details.collapsedFolders }


isFolderCollapsed : String -> Model -> Bool
isFolderCollapsed path (Model details) =
    Set.member path details.collapsedFolders


fileLoaded : FileRequest -> FileContent -> Model -> Model
fileLoaded request value =
    mapFileRequest request (\details -> { details | selectedFile = Success request value })


fileFailed : FileRequest -> ApiError -> Model -> Model
fileFailed request error =
    mapFileRequest request (\details -> { details | selectedFile = Failure request error })


searchLoaded : SearchRequest -> SearchResults -> Model -> Model
searchLoaded request value =
    mapSearchRequest request (\details -> { details | search = Success request value })


searchFailed : SearchRequest -> ApiError -> Model -> Model
searchFailed request error =
    mapSearchRequest request (\details -> { details | search = Failure request error })


fileRepository : FileRequest -> String
fileRepository (FileRequest repository _) =
    repository


filePath : FileRequest -> String
filePath (FileRequest _ path) =
    path


searchRepository : SearchRequest -> String
searchRepository (SearchRequest repository _ _) =
    repository


searchQuery : SearchRequest -> String
searchQuery (SearchRequest _ query _) =
    query


requestSearchMode : SearchRequest -> SearchMode
requestSearchMode (SearchRequest _ _ mode) =
    mode


selectedRequest : String -> Maybe String -> Remote FileRequest error value
selectedRequest repository path =
    path
        |> Maybe.map (FileRequest repository >> Loading)
        |> Maybe.withDefault NotAsked


searchRequest : String -> String -> SearchMode -> Remote SearchRequest error value
searchRequest repository query mode =
    if query == "" then
        NotAsked

    else
        Loading (SearchRequest repository query mode)


collapsedFor : Maybe String -> List File -> Set String
collapsedFor path files =
    FileTree.build .path files
        |> FileTree.directoryPaths
        |> FileTree.reveal (Maybe.withDefault "" path)
        |> Set.fromList


reveal : Maybe String -> Set String -> Set String
reveal path collapsed =
    case path of
        Just selected ->
            collapsed
                |> Set.toList
                |> FileTree.reveal selected
                |> Set.fromList

        Nothing ->
            collapsed


mapFileRequest : FileRequest -> (Details -> Details) -> Model -> Model
mapFileRequest request transform ((Model details) as model) =
    if Remote.identity details.selectedFile == Just request then
        Model (transform details)

    else
        model


mapSearchRequest : SearchRequest -> (Details -> Details) -> Model -> Model
mapSearchRequest request transform ((Model details) as model) =
    if Remote.identity details.search == Just request then
        Model (transform details)

    else
        model


toggleSet : comparable -> Set comparable -> Set comparable
toggleSet item values =
    if Set.member item values then
        Set.remove item values

    else
        Set.insert item values
