module Hunker.Repository.Files exposing
    ( FileRequest
    , Model
    , SearchRequest
    , fileFailed
    , fileLoaded
    , filePath
    , fileRepository
    , init
    , search
    , searchFailed
    , searchLoaded
    , searchMode
    , searchQuery
    , searchRepository
    , selectedFile
    )

import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Repository exposing (FileContent, SearchResults)
import Hunker.Remote as Remote exposing (Remote(..))
import Hunker.Route exposing (SearchMode)


type Model
    = Model Details


type alias Details =
    { selectedFile : Remote FileRequest ApiError FileContent
    , search : Remote SearchRequest ApiError SearchResults
    }


type FileRequest
    = FileRequest String String


type SearchRequest
    = SearchRequest String String SearchMode


init : String -> Maybe String -> String -> SearchMode -> Model
init repository path query mode =
    Model
        { selectedFile =
            path
                |> Maybe.map (FileRequest repository >> Loading)
                |> Maybe.withDefault NotAsked
        , search =
            if query == "" then
                NotAsked

            else
                Loading (SearchRequest repository query mode)
        }


selectedFile : Model -> Remote FileRequest ApiError FileContent
selectedFile (Model details) =
    details.selectedFile


search : Model -> Remote SearchRequest ApiError SearchResults
search (Model details) =
    details.search


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


searchMode : SearchRequest -> SearchMode
searchMode (SearchRequest _ _ mode) =
    mode


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
