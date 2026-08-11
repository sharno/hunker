module Hunker.Review.DiffView exposing
    ( FileState
    , FullFileRequest
    , Model
    , SearchMode(..)
    , changeFilter
    , collapseFolder
    , fileFailed
    , fileFullFile
    , fileIsCollapsed
    , fileIsHunkCollapsed
    , fileIsReviewed
    , fileIsSourceFoldCollapsed
    , fileLoaded
    , fileState
    , filter
    , filterMode
    , init
    , isFolderCollapsed
    , isReviewed
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
    , files : Dict String FileState
    , filter : String
    , filterMode : SearchMode
    , collapsedFolders : Set String
    }


type FileState
    = FileState
        { fullFile : Maybe (Remote FullFileRequest ApiError FullFile)
        , collapsed : Bool
        , collapsedHunks : Set String
        , reviewed : Bool
        , collapsedSourceFolds : Set String
        }


type SearchMode
    = Literal
    | Regex


type FullFileRequest
    = FullFileRequest Session.Id String


init : Session.Id -> List String -> Model
init session paths =
    Model
        { session = session
        , files = Dict.fromList (List.map (\path -> ( path, emptyFileState )) paths)
        , filter = ""
        , filterMode = Literal
        , collapsedFolders = Set.empty
        }


emptyFileState : FileState
emptyFileState =
    FileState
        { fullFile = Nothing
        , collapsed = False
        , collapsedHunks = Set.empty
        , reviewed = False
        , collapsedSourceFolds = Set.empty
        }


fileState : String -> Model -> Maybe FileState
fileState path (Model details) =
    Dict.get path details.files


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


fileFullFile : FileState -> Maybe (Remote FullFileRequest ApiError FullFile)
fileFullFile (FileState state) =
    state.fullFile


toggleFullFile : String -> Model -> ( Model, Maybe FullFileRequest )
toggleFullFile path ((Model details) as model) =
    case Dict.get path details.files of
        Nothing ->
            ( model, Nothing )

        Just file ->
            case fileFullFile file of
                Just (Success _ _) ->
                    ( updateFile path (\(FileState state) -> FileState { state | fullFile = Nothing }) model, Nothing )

                Just (Loading _) ->
                    ( model, Nothing )

                _ ->
                    let
                        request =
                            FullFileRequest details.session path
                    in
                    ( updateFile path (\(FileState state) -> FileState { state | fullFile = Just (Loading request) }) model
                    , Just request
                    )


fileLoaded : FullFileRequest -> FullFile -> Model -> Model
fileLoaded request value =
    mapRequest request (updateFileDetails (requestPath request) (\(FileState state) -> FileState { state | fullFile = Just (Success request value) }))


fileFailed : FullFileRequest -> ApiError -> Model -> Model
fileFailed request error =
    mapRequest request (updateFileDetails (requestPath request) (\(FileState state) -> FileState { state | fullFile = Just (Failure request error) }))


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
    Model (updateFileDetails path (\(FileState state) -> FileState { state | collapsed = not state.collapsed }) details)


fileIsCollapsed : FileState -> Bool
fileIsCollapsed (FileState state) =
    state.collapsed


revealFile : String -> Model -> Model
revealFile path (Model details) =
    Model (updateFileDetails path (\(FileState state) -> FileState { state | collapsed = False }) details)


toggleHunk : String -> String -> Model -> Model
toggleHunk path hunkId (Model details) =
    Model (updateFileDetails path (\(FileState state) -> FileState { state | collapsedHunks = toggleSet hunkId state.collapsedHunks }) details)


fileIsHunkCollapsed : String -> FileState -> Bool
fileIsHunkCollapsed hunkId (FileState state) =
    Set.member hunkId state.collapsedHunks


toggleReviewed : String -> Model -> Model
toggleReviewed path (Model details) =
    Model
        (updateFileDetails path
            (\(FileState state) ->
                FileState
                    { state
                        | reviewed = not state.reviewed
                        , collapsed = not state.reviewed
                    }
            )
            details
        )


isReviewed : String -> Model -> Bool
isReviewed path (Model details) =
    Dict.get path details.files |> Maybe.map fileIsReviewed |> Maybe.withDefault False


fileIsReviewed : FileState -> Bool
fileIsReviewed (FileState state) =
    state.reviewed


toggleSourceFold : String -> String -> Model -> Model
toggleSourceFold path fold (Model details) =
    Model (updateFileDetails path (\(FileState state) -> FileState { state | collapsedSourceFolds = toggleSet fold state.collapsedSourceFolds }) details)


fileIsSourceFoldCollapsed : String -> FileState -> Bool
fileIsSourceFoldCollapsed fold (FileState state) =
    Set.member fold state.collapsedSourceFolds


collapseFolder : String -> Model -> Model
collapseFolder path (Model details) =
    Model { details | collapsedFolders = Set.insert path details.collapsedFolders }


mapRequest : FullFileRequest -> (Details -> Details) -> Model -> Model
mapRequest (FullFileRequest requested _) transform ((Model details) as model) =
    if requested == details.session then
        Model (transform details)

    else
        model


updateFile : String -> (FileState -> FileState) -> Model -> Model
updateFile path transform (Model details) =
    Model (updateFileDetails path transform details)


updateFileDetails : String -> (FileState -> FileState) -> Details -> Details
updateFileDetails path transform details =
    { details | files = Dict.update path (Maybe.map transform) details.files }


toggleSet : comparable -> Set comparable -> Set comparable
toggleSet item values =
    if Set.member item values then
        Set.remove item values

    else
        Set.insert item values
