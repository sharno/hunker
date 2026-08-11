module Hunker.Review.DiffView exposing
    ( FullFileRequest
    , Model
    , SearchMode(..)
    , changeFilter
    , collapseFolder
    , collapsedFiles
    , fileFailed
    , fileLoaded
    , filter
    , filterMode
    , fullFile
    , init
    , isFileCollapsed
    , isFolderCollapsed
    , isHunkCollapsed
    , isReviewed
    , isSourceFoldCollapsed
    , requestPath
    , requestUrl
    , revealFile
    , selectSearchMode
    , toggleFile
    , toggleFolder
    , toggleFullFile
    , toggleHunk
    , toggleReviewed
    , toggleSourceFold
    )

import Dict exposing (Dict)
import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Review exposing (FullFile)
import Hunker.Remote exposing (Remote(..))
import Hunker.Review.Session as Session
import Set exposing (Set)


type Model
    = Model Details


type alias Details =
    { session : Session.Id
    , fullFiles : Dict String (Remote FullFileRequest ApiError FullFile)
    , filter : String
    , filterMode : SearchMode
    , collapsedFolders : Set String
    , collapsedFiles : Set String
    , collapsedHunks : Set String
    , reviewedFiles : Set String
    , collapsedSourceFolds : Set String
    }


type SearchMode
    = Literal
    | Regex


type FullFileRequest
    = FullFileRequest Session.Id String


init : Session.Id -> Model
init session =
    Model
        { session = session
        , fullFiles = Dict.empty
        , filter = ""
        , filterMode = Literal
        , collapsedFolders = Set.empty
        , collapsedFiles = Set.empty
        , collapsedHunks = Set.empty
        , reviewedFiles = Set.empty
        , collapsedSourceFolds = Set.empty
        }


filter : Model -> String
filter (Model details) =
    details.filter


filterMode : Model -> SearchMode
filterMode (Model details) =
    details.filterMode


changeFilter : String -> Model -> Model
changeFilter value (Model details) =
    Model { details | filter = value }


selectSearchMode : SearchMode -> Model -> Model
selectSearchMode value (Model details) =
    Model { details | filterMode = value }


fullFile : String -> Model -> Maybe (Remote FullFileRequest ApiError FullFile)
fullFile path (Model details) =
    Dict.get path details.fullFiles


toggleFullFile : String -> Model -> ( Model, Maybe FullFileRequest )
toggleFullFile path ((Model details) as model) =
    case Dict.get path details.fullFiles of
        Just (Success _ _) ->
            ( Model { details | fullFiles = Dict.remove path details.fullFiles }, Nothing )

        Just (Loading _) ->
            ( model, Nothing )

        _ ->
            let
                request =
                    FullFileRequest details.session path
            in
            ( Model { details | fullFiles = Dict.insert path (Loading request) details.fullFiles }
            , Just request
            )


fileLoaded : FullFileRequest -> FullFile -> Model -> Model
fileLoaded request value =
    mapRequest request (\details -> { details | fullFiles = Dict.insert (requestPath request) (Success request value) details.fullFiles })


fileFailed : FullFileRequest -> ApiError -> Model -> Model
fileFailed request error =
    mapRequest request (\details -> { details | fullFiles = Dict.insert (requestPath request) (Failure request error) details.fullFiles })


requestUrl : FullFileRequest -> String
requestUrl (FullFileRequest session _) =
    Session.requestUrl session


requestPath : FullFileRequest -> String
requestPath (FullFileRequest _ path) =
    path


toggleFolder : String -> Model -> Model
toggleFolder path (Model details) =
    Model { details | collapsedFolders = toggleSet path details.collapsedFolders }


isFolderCollapsed : String -> Model -> Bool
isFolderCollapsed path (Model details) =
    Set.member path details.collapsedFolders


toggleFile : String -> Model -> Model
toggleFile path (Model details) =
    Model { details | collapsedFiles = toggleSet path details.collapsedFiles }


isFileCollapsed : String -> Model -> Bool
isFileCollapsed path (Model details) =
    Set.member path details.collapsedFiles


collapsedFiles : Model -> Set String
collapsedFiles (Model details) =
    details.collapsedFiles


revealFile : String -> Model -> Model
revealFile path (Model details) =
    Model { details | collapsedFiles = Set.remove path details.collapsedFiles }


toggleHunk : String -> String -> Model -> Model
toggleHunk path hunkId (Model details) =
    Model { details | collapsedHunks = toggleSet (hunkKey path hunkId) details.collapsedHunks }


isHunkCollapsed : String -> String -> Model -> Bool
isHunkCollapsed path hunkId (Model details) =
    Set.member (hunkKey path hunkId) details.collapsedHunks


toggleReviewed : String -> Model -> Model
toggleReviewed path (Model details) =
    let
        reviewed =
            Set.member path details.reviewedFiles
    in
    Model
        { details
            | reviewedFiles = toggleSet path details.reviewedFiles
            , collapsedFiles =
                if reviewed then
                    Set.remove path details.collapsedFiles

                else
                    Set.insert path details.collapsedFiles
        }


isReviewed : String -> Model -> Bool
isReviewed path (Model details) =
    Set.member path details.reviewedFiles


toggleSourceFold : String -> Model -> Model
toggleSourceFold fold (Model details) =
    Model { details | collapsedSourceFolds = toggleSet fold details.collapsedSourceFolds }


isSourceFoldCollapsed : String -> Model -> Bool
isSourceFoldCollapsed fold (Model details) =
    Set.member fold details.collapsedSourceFolds


collapseFolder : String -> Model -> Model
collapseFolder path (Model details) =
    Model { details | collapsedFolders = Set.insert path details.collapsedFolders }


mapRequest : FullFileRequest -> (Details -> Details) -> Model -> Model
mapRequest (FullFileRequest requested _) transform ((Model details) as model) =
    if requested == details.session then
        Model (transform details)

    else
        model


hunkKey : String -> String -> String
hunkKey path hunkId =
    path ++ ":" ++ hunkId


toggleSet : comparable -> Set comparable -> Set comparable
toggleSet item values =
    if Set.member item values then
        Set.remove item values

    else
        Set.insert item values
