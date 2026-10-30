module Hunker.Review.DiffView exposing
    ( FileState
    , Filter(..)
    , FullFileRequest
    , Model
    , SearchMode(..)
    , changeFilter
    , closeOptions
    , fileFailed
    , fileFullFile
    , fileIsCollapsed
    , fileIsHunkCollapsed
    , fileIsReviewed
    , fileIsSourceFoldCollapsed
    , fileLoaded
    , fileState
    , filter
    , filterText
    , init
    , isFolderCollapsed
    , matches
    , optionsOpen
    , requestPath
    , revealFile
    , searchMode
    , selectSearchMode
    , toggleFile
    , toggleFolder
    , toggleFullFile
    , toggleHunk
    , toggleOptions
    , toggleReviewed
    , toggleSourceFold
    )

import Dict exposing (Dict)
import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Review exposing (FullFile)
import Hunker.PreparedDiff exposing (PreparedFile)
import Hunker.Remote exposing (Remote(..))
import Hunker.Review.Session as Session
import Regex exposing (Regex)
import Set exposing (Set)


type Model
    = Model Details


type alias Details =
    { session : Session.Id
    , files : Dict String FileState
    , filterText : String
    , searchMode : SearchMode
    , filter : Filter
    , collapsedFolders : Set String
    , options : Disclosure
    }


type Disclosure
    = Open
    | Closed


{-| Per-file UI state. Files without an entry use `emptyFileState`, one
shared value, so their lazily rendered panels keep a stable identity.
-}
type FileState
    = FileState
        { fullFile : Remote FullFileRequest ApiError FullFile
        , collapsed : Bool
        , collapsedHunks : Set String
        , reviewed : Bool
        , collapsedSourceFolds : Set String
        }


type SearchMode
    = Literal
    | Regex


{-| The review search, compiled once when it changes rather than per file.
-}
type Filter
    = NoFilter
    | TextFilter String
    | PatternFilter Regex
    | InvalidPattern


type FullFileRequest
    = FullFileRequest Session.Id String


init : Session.Id -> Model
init session =
    Model
        { session = session
        , files = Dict.empty
        , filterText = ""
        , searchMode = Literal
        , filter = NoFilter
        , collapsedFolders = Set.empty
        , options = Closed
        }


emptyFileState : FileState
emptyFileState =
    FileState
        { fullFile = NotAsked
        , collapsed = False
        , collapsedHunks = Set.empty
        , reviewed = False
        , collapsedSourceFolds = Set.empty
        }


fileState : String -> Model -> FileState
fileState path (Model details) =
    Dict.get path details.files |> Maybe.withDefault emptyFileState


filterText : Model -> String
filterText (Model details) =
    details.filterText


searchMode : Model -> SearchMode
searchMode (Model details) =
    details.searchMode


filter : Model -> Filter
filter (Model details) =
    details.filter


changeFilter : String -> Model -> Model
changeFilter value (Model details) =
    Model { details | filterText = value, filter = compile details.searchMode value }


selectSearchMode : SearchMode -> Model -> Model
selectSearchMode mode (Model details) =
    Model { details | searchMode = mode, filter = compile mode details.filterText }


compile : SearchMode -> String -> Filter
compile mode text =
    if String.trim text == "" then
        NoFilter

    else
        case mode of
            Literal ->
                TextFilter (String.toLower (String.trim text))

            Regex ->
                Regex.fromString text
                    |> Maybe.map PatternFilter
                    |> Maybe.withDefault InvalidPattern


matches : Filter -> PreparedFile -> Bool
matches compiled file =
    case compiled of
        NoFilter ->
            True

        TextFilter query ->
            String.contains query file.searchText

        PatternFilter expression ->
            Regex.contains expression (file.change.path ++ "\n" ++ file.change.patch)

        InvalidPattern ->
            False


optionsOpen : Model -> Bool
optionsOpen (Model details) =
    details.options == Open


toggleOptions : Model -> Model
toggleOptions (Model details) =
    Model
        { details
            | options =
                case details.options of
                    Open ->
                        Closed

                    Closed ->
                        Open
        }


closeOptions : Model -> Model
closeOptions (Model details) =
    Model { details | options = Closed }


fileFullFile : FileState -> Remote FullFileRequest ApiError FullFile
fileFullFile (FileState state) =
    state.fullFile


{-| Shows the full file, hides it again, or retries a failure. A request in
flight is not duplicated.
-}
toggleFullFile : String -> Model -> ( Model, Maybe FullFileRequest )
toggleFullFile path ((Model details) as model) =
    let
        request =
            FullFileRequest details.session path

        setFullFile value =
            updateFile path (\(FileState state) -> FileState { state | fullFile = value }) model
    in
    case fileFullFile (fileState path model) of
        Success _ _ ->
            ( setFullFile NotAsked, Nothing )

        Loading _ ->
            ( model, Nothing )

        NotAsked ->
            ( setFullFile (Loading request), Just request )

        Failure _ _ ->
            ( setFullFile (Loading request), Just request )


fileLoaded : FullFileRequest -> FullFile -> Model -> Model
fileLoaded request value =
    settleFullFile request (Success request value)


fileFailed : FullFileRequest -> ApiError -> Model -> Model
fileFailed request error =
    settleFullFile request (Failure request error)


settleFullFile : FullFileRequest -> Remote FullFileRequest ApiError FullFile -> Model -> Model
settleFullFile request result model =
    let
        path =
            requestPath request
    in
    case fileFullFile (fileState path model) of
        Loading active ->
            if active == request then
                updateFile path (\(FileState state) -> FileState { state | fullFile = result }) model

            else
                model

        NotAsked ->
            model

        Success _ _ ->
            model

        Failure _ _ ->
            model


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
toggleFile path =
    updateFile path (\(FileState state) -> FileState { state | collapsed = not state.collapsed })


fileIsCollapsed : FileState -> Bool
fileIsCollapsed (FileState state) =
    state.collapsed


revealFile : String -> Model -> Model
revealFile path =
    updateFile path (\(FileState state) -> FileState { state | collapsed = False })


toggleHunk : String -> String -> Model -> Model
toggleHunk path hunkId =
    updateFile path (\(FileState state) -> FileState { state | collapsedHunks = toggleSet hunkId state.collapsedHunks })


fileIsHunkCollapsed : String -> FileState -> Bool
fileIsHunkCollapsed hunkId (FileState state) =
    Set.member hunkId state.collapsedHunks


{-| Marking a file reviewed also collapses it.
-}
toggleReviewed : String -> Model -> Model
toggleReviewed path =
    updateFile path
        (\(FileState state) ->
            FileState
                { state
                    | reviewed = not state.reviewed
                    , collapsed = not state.reviewed
                }
        )


fileIsReviewed : FileState -> Bool
fileIsReviewed (FileState state) =
    state.reviewed


toggleSourceFold : String -> String -> Model -> Model
toggleSourceFold path fold =
    updateFile path (\(FileState state) -> FileState { state | collapsedSourceFolds = toggleSet fold state.collapsedSourceFolds })


fileIsSourceFoldCollapsed : String -> FileState -> Bool
fileIsSourceFoldCollapsed fold (FileState state) =
    Set.member fold state.collapsedSourceFolds


updateFile : String -> (FileState -> FileState) -> Model -> Model
updateFile path transform ((Model details) as model) =
    Model { details | files = Dict.insert path (transform (fileState path model)) details.files }


toggleSet : comparable -> Set comparable -> Set comparable
toggleSet item values =
    if Set.member item values then
        Set.remove item values

    else
        Set.insert item values
