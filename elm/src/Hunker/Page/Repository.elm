module Hunker.Page.Repository exposing
    ( Model
    , Msg(..)
    , init
    , navigate
    , repositoryName
    , subscriptions
    , toolbar
    , update
    , view
    )

import Html exposing (Html, a, aside, button, code, div, form, h1, h2, header, img, input, label, main_, option, p, pre, section, select, small, span, strong, text)
import Html.Attributes exposing (attribute, class, disabled, href, id, placeholder, selected, src, title, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import Hunker.Api as Api
import Hunker.ApiError as ApiError exposing (ApiError)
import Hunker.Domain.Repository as Repository exposing (Checkout(..), Commit, File, FileContent, PullRequest, PullRequestsPage, SearchResults, SourceControlStatus)
import Hunker.Effect as Effect exposing (Effect)
import Hunker.FileTree as FileTree exposing (Tree(..))
import Hunker.Remote as Remote exposing (Remote(..))
import Hunker.Repository.Files as RepositoryFiles
import Hunker.Repository.Pulls as RepositoryPulls
import Hunker.Repository.SourceControl as SourceControl
import Hunker.Route as Route exposing (PullRequestState(..), RepositoryTab(..), SearchMode(..))
import Hunker.Syntax as Syntax
import Time
import Url


type alias Model =
    { location : Route.RepositoryLocation
    , repository : RepositoryState
    }


type RepositoryState
    = Resolving RepositoryRequest
    | Missing MissingRepository
    | Failed RepositoryRequest ApiError
    | Ready ReadyRepository


type RepositoryRequest
    = RepositoryRequest String


type alias ReadyRepository =
    { request : RepositoryRequest
    , files : RepositoryFiles.Model
    , view : RepositoryView
    , sourceControl : SourceControl.State
    }


type alias MissingRepository =
    { request : RepositoryRequest
    , error : ApiError
    , clone : CloneState
    }


type RepositoryView
    = Files
    | Commits (Remote RepositoryRequest ApiError Repository.Commits)
    | PullRequests RepositoryPulls.Model


type CloneState
    = CloneIdle
    | CloneInFlight CloneRequest
    | CloneFailure CloneRequest ApiError


type CloneRequest
    = CloneRequest String String


type Msg
    = FilesLoaded String (List File)
    | FilesFailed String ApiError
    | FileLoaded RepositoryFiles.FileRequest FileContent
    | FileFailed RepositoryFiles.FileRequest ApiError
    | SearchLoaded RepositoryFiles.SearchRequest SearchResults
    | SearchFailed RepositoryFiles.SearchRequest ApiError
    | CommitsLoaded RepositoryRequest Repository.Commits
    | CommitsFailed RepositoryRequest ApiError
    | PullsLoaded RepositoryPulls.Identity PullRequestsPage
    | PullsFailed RepositoryPulls.Identity ApiError
    | SourceLoaded String SourceControlStatus
    | PullCompleted String Int
    | PullStatusLoaded String Int SourceControlStatus
    | PullStatusFailed String ApiError
    | SourceFailed String ApiError
    | CloneLoaded CloneRequest String
    | CloneFailed CloneRequest ApiError
    | ChangedSearch String
    | SelectedSearchMode SearchMode
    | SubmittedSearch
    | SelectedTab RepositoryTab
    | SelectedFile String
    | ClosedFile
    | ToggledFolder String
    | SelectedPullState PullRequestState
    | RequestedMorePulls
    | SelectedBranch String
    | RequestedSourceRefresh
    | RequestedPull
    | RequestedClone String
    | SelectedCommit Commit
    | PollSourceControl Time.Posix


init : Route.RepositoryLocation -> ( Model, Effect Msg )
init location =
    let
        name =
            location.owner ++ "/" ++ location.repository

        request =
            RepositoryRequest name

        model =
            { location = location
            , repository = Resolving request
            }
    in
    ( model, Api.fetchRepositoryFiles name (FilesLoaded name) (FilesFailed name) )


initialView : String -> Route.RepositoryLocation -> RepositoryView
initialView name location =
    case location.tab of
        RepositoryFiles ->
            Files

        RepositoryCommits ->
            Commits (Loading (RepositoryRequest name))

        RepositoryPulls ->
            PullRequests (RepositoryPulls.init name location.pullState)


loadView : RepositoryFiles.Model -> RepositoryView -> Effect Msg
loadView files viewState =
    case viewState of
        Files ->
            Effect.batch
                [ case RepositoryFiles.selectedFile files of
                    Loading request ->
                        Api.fetchRepositoryFile (RepositoryFiles.fileRepository request) (RepositoryFiles.filePath request) (FileLoaded request) (FileFailed request)

                    _ ->
                        Effect.none
                , case RepositoryFiles.search files of
                    Loading request ->
                        Api.searchRepository
                            (RepositoryFiles.searchRepository request)
                            (RepositoryFiles.searchQuery request)
                            (Route.searchModeToString (RepositoryFiles.requestSearchMode request))
                            (SearchLoaded request)
                            (SearchFailed request)

                    _ ->
                        Effect.none
                ]

        Commits (Loading request) ->
            Api.fetchRepositoryCommits (repositoryRequestName request) (CommitsLoaded request) (CommitsFailed request)

        Commits _ ->
            Effect.none

        PullRequests pulls ->
            case RepositoryPulls.request pulls of
                Loading request ->
                    loadPullRequests request

                _ ->
                    Effect.none


loadPullRequests : RepositoryPulls.Identity -> Effect Msg
loadPullRequests request =
    Api.fetchRepositoryPulls
        (RepositoryPulls.identityRepository request)
        (Route.pullRequestStateToString (RepositoryPulls.identityState request))
        (RepositoryPulls.identityPage request)
        (PullsLoaded request)
        (PullsFailed request)


navigate : Route.RepositoryLocation -> Model -> ( Model, Effect Msg )
navigate nextLocation model =
    if
        nextLocation.owner
            /= model.location.owner
            || nextLocation.repository
            /= model.location.repository
    then
        init nextLocation

    else
        navigateWithinRepository nextLocation model


navigateWithinRepository : Route.RepositoryLocation -> Model -> ( Model, Effect Msg )
navigateWithinRepository nextLocation model =
    if nextLocation == model.location then
        unchanged model

    else
        let
            nextView =
                initialView (repositoryName model) nextLocation

            updated =
                { model
                    | location = nextLocation
                    , repository =
                        mapReady
                            (\ready ->
                                { ready
                                    | files = RepositoryFiles.navigate nextLocation.path nextLocation.query nextLocation.searchMode ready.files
                                    , view = nextView
                                }
                            )
                            model.repository
                }
        in
        ( updated
        , readyState updated
            |> Maybe.map (\ready -> loadView ready.files ready.view)
            |> Maybe.withDefault Effect.none
        )


repositoryName : Model -> String
repositoryName model =
    model.location.owner ++ "/" ++ model.location.repository


repositoryRequestName : RepositoryRequest -> String
repositoryRequestName (RepositoryRequest name) =
    name


readyState : Model -> Maybe ReadyRepository
readyState model =
    case model.repository of
        Ready ready ->
            Just ready

        _ ->
            Nothing


mapReady : (ReadyRepository -> ReadyRepository) -> RepositoryState -> RepositoryState
mapReady transform state =
    case state of
        Ready ready ->
            Ready (transform ready)

        _ ->
            state


repositoryView : RepositoryState -> Maybe RepositoryView
repositoryView state =
    case state of
        Ready ready ->
            Just ready.view

        _ ->
            Nothing


mapRepositoryView : (RepositoryView -> RepositoryView) -> RepositoryState -> RepositoryState
mapRepositoryView transform state =
    mapReady (\ready -> { ready | view = transform ready.view }) state


repositorySourceControl : RepositoryState -> Maybe SourceControl.State
repositorySourceControl state =
    case state of
        Ready ready ->
            Just ready.sourceControl

        _ ->
            Nothing


withSourceControl : SourceControl.State -> RepositoryState -> RepositoryState
withSourceControl source state =
    mapReady (\ready -> { ready | sourceControl = source }) state


mapFilesView : (RepositoryFiles.Model -> RepositoryFiles.Model) -> RepositoryState -> RepositoryState
mapFilesView transform =
    mapReady (\ready -> { ready | files = transform ready.files })


mapCommitsView : (Remote RepositoryRequest ApiError Repository.Commits -> Remote RepositoryRequest ApiError Repository.Commits) -> RepositoryState -> RepositoryState
mapCommitsView transform =
    mapRepositoryView
        (\current ->
            case current of
                Commits commits ->
                    Commits (transform commits)

                _ ->
                    current
        )


mapPullsView : (RepositoryPulls.Model -> RepositoryPulls.Model) -> RepositoryState -> RepositoryState
mapPullsView transform =
    mapRepositoryView
        (\current ->
            case current of
                PullRequests pulls ->
                    PullRequests (transform pulls)

                _ ->
                    current
        )


cloneRequestRepository : CloneRequest -> String
cloneRequestRepository (CloneRequest name _) =
    name


subscriptions : Model -> Sub Msg
subscriptions _ =
    Time.every 120000 PollSourceControl


update : Msg -> Model -> ( Model, Effect Msg )
update msg model =
    case msg of
        FilesLoaded requested files ->
            if requested /= repositoryName model then
                unchanged model

            else
                let
                    request =
                        RepositoryRequest requested

                    fileBrowser =
                        RepositoryFiles.init requested files model.location.path model.location.query model.location.searchMode

                    viewState =
                        initialView requested model.location

                    updated =
                        { model
                            | repository =
                                Ready
                                    { request = request
                                    , files = fileBrowser
                                    , view = viewState
                                    , sourceControl = SourceControl.Loading requested
                                    }
                        }
                in
                ( updated
                , Effect.batch
                    [ Api.refreshSourceControl requested (SourceLoaded requested) (SourceFailed requested)
                    , loadView fileBrowser viewState
                    ]
                )

        FilesFailed requested error ->
            if requested == repositoryName model then
                ( { model
                    | repository =
                        if ApiError.isNotFound error then
                            Missing
                                { request = RepositoryRequest requested
                                , error = error
                                , clone = CloneIdle
                                }

                        else
                            Failed (RepositoryRequest requested) error
                  }
                , Effect.none
                )

            else
                unchanged model

        FileLoaded request file ->
            ( { model | repository = mapFilesView (RepositoryFiles.fileLoaded request file) model.repository }, Effect.none )

        FileFailed request error ->
            ( { model | repository = mapFilesView (RepositoryFiles.fileFailed request error) model.repository }, Effect.none )

        SearchLoaded request results ->
            ( { model | repository = mapFilesView (RepositoryFiles.searchLoaded request results) model.repository }, Effect.none )

        SearchFailed request error ->
            ( { model | repository = mapFilesView (RepositoryFiles.searchFailed request error) model.repository }, Effect.none )

        CommitsLoaded requested commits ->
            if repositoryRequestName requested == repositoryName model then
                ( { model | repository = mapCommitsView (always (Success requested commits)) model.repository }, Effect.none )

            else
                unchanged model

        CommitsFailed requested error ->
            if repositoryRequestName requested == repositoryName model then
                ( { model | repository = mapCommitsView (always (Failure requested error)) model.repository }, Effect.none )

            else
                unchanged model

        PullsLoaded request page ->
            ( { model | repository = mapPullsView (RepositoryPulls.loaded request page) model.repository }, Effect.none )

        PullsFailed request error ->
            ( { model | repository = mapPullsView (RepositoryPulls.failed request error) model.repository }, Effect.none )

        SourceLoaded requested status ->
            if requested == repositoryName model then
                ( { model
                    | repository =
                        withSourceControl
                            (SourceControl.Ready
                                { repository = requested
                                , status = status
                                , activity = SourceControl.Idle
                                }
                            )
                            model.repository
                  }
                , Effect.none
                )

            else
                unchanged model

        PullCompleted requested count ->
            updateReadySource requested model <|
                \source ->
                    ( { model
                        | repository =
                            withSourceControl
                                (SourceControl.Ready { source | activity = SourceControl.PullSynchronizing count })
                                model.repository
                      }
                    , Api.refreshSourceControl requested
                        (PullStatusLoaded requested count)
                        (PullStatusFailed requested)
                    )

        PullStatusLoaded requested count status ->
            if requested == repositoryName model then
                ( { model
                    | repository =
                        withSourceControl
                            (SourceControl.Ready
                                { repository = requested
                                , status = status
                                , activity = SourceControl.Succeeded (SourceControl.pulledMessage count)
                                }
                            )
                            model.repository
                  }
                , Effect.none
                )

            else
                unchanged model

        PullStatusFailed requested error ->
            if requested == repositoryName model then
                ( { model
                    | repository =
                        withSourceControl
                            (SourceControl.Unavailable requested
                                (ApiError.context "The pull completed, but Git status could not be refreshed. " error)
                            )
                            model.repository
                  }
                , Effect.none
                )

            else
                unchanged model

        SourceFailed requested error ->
            if requested == repositoryName model then
                ( { model | repository = withSourceControl (SourceControl.Unavailable requested error) model.repository }, Effect.none )

            else
                unchanged model

        CloneLoaded request _ ->
            if cloneRequestRepository request /= repositoryName model then
                unchanged model

            else
                let
                    name =
                        repositoryName model
                in
                ( { model
                    | repository = Resolving (RepositoryRequest name)
                  }
                , Api.fetchRepositoryFiles name (FilesLoaded name) (FilesFailed name)
                )

        CloneFailed request error ->
            if cloneRequestRepository request == repositoryName model then
                case model.repository of
                    Missing missing ->
                        ( { model | repository = Missing { missing | clone = CloneFailure request error } }, Effect.none )

                    _ ->
                        unchanged model

            else
                unchanged model

        ChangedSearch query ->
            ( { model | repository = mapFilesView (RepositoryFiles.changeSearchDraft query) model.repository }, Effect.none )

        SelectedSearchMode mode ->
            ( { model | repository = mapFilesView (RepositoryFiles.selectSearchMode mode) model.repository }, Effect.none )

        SubmittedSearch ->
            case readyState model of
                Just ready ->
                    ( model
                    , Effect.PushUrl
                        (repositoryPath model
                            RepositoryFiles
                            Nothing
                            (RepositoryFiles.searchDraft ready.files)
                            (RepositoryFiles.searchMode ready.files)
                            model.location.pullState
                        )
                    )

                Nothing ->
                    unchanged model

        SelectedTab tab ->
            ( model, Effect.PushUrl (repositoryPath model tab Nothing "" LiteralSearch model.location.pullState) )

        SelectedFile path ->
            ( model, Effect.PushUrl (repositoryPath model RepositoryFiles (Just path) model.location.query model.location.searchMode model.location.pullState) )

        ClosedFile ->
            ( model, Effect.PushUrl (repositoryPath model RepositoryFiles Nothing model.location.query model.location.searchMode model.location.pullState) )

        ToggledFolder path ->
            ( { model | repository = mapFilesView (RepositoryFiles.toggleFolder path) model.repository }, Effect.none )

        SelectedPullState state ->
            ( model, Effect.PushUrl (repositoryPath model RepositoryPulls Nothing "" LiteralSearch state) )

        RequestedMorePulls ->
            case repositoryView model.repository of
                Just (PullRequests pulls) ->
                    case RepositoryPulls.more pulls of
                        Just ( updated, request ) ->
                            ( { model | repository = mapPullsView (always updated) model.repository }
                            , loadPullRequests request
                            )

                        Nothing ->
                            unchanged model

                _ ->
                    unchanged model

        SelectedBranch branch ->
            let
                name =
                    repositoryName model
            in
            updateReadySource name model <|
                \source ->
                    if SourceControl.busy source.activity then
                        unchanged model

                    else
                        ( { model | repository = withSourceControl (SourceControl.Ready { source | activity = SourceControl.BranchSwitching branch }) model.repository }
                        , Api.switchBranch name branch (SourceLoaded name) (SourceFailed name)
                        )

        RequestedSourceRefresh ->
            refreshSource model

        RequestedPull ->
            let
                name =
                    repositoryName model
            in
            updateReadySource name model <|
                \source ->
                    if SourceControl.busy source.activity || not (SourceControl.canPull source.status) then
                        unchanged model

                    else
                        ( { model | repository = withSourceControl (SourceControl.Ready { source | activity = SourceControl.PullInFlight }) model.repository }
                        , Api.pullRepository name (PullCompleted name) (SourceFailed name)
                        )

        RequestedClone destination ->
            let
                request =
                    CloneRequest (repositoryName model) destination
            in
            case model.repository of
                Missing missing ->
                    ( { model | repository = Missing { missing | clone = CloneInFlight request } }
                    , Api.cloneRepository (repositoryName model) destination (CloneLoaded request) (CloneFailed request)
                    )

                _ ->
                    unchanged model

        SelectedCommit commit ->
            ( model
            , Effect.PushUrl
                ("/"
                    ++ Url.percentEncode model.location.owner
                    ++ "/"
                    ++ Url.percentEncode model.location.repository
                    ++ "/commit/"
                    ++ Url.percentEncode commit.sha
                )
            )

        PollSourceControl _ ->
            refreshSource model


refreshSource : Model -> ( Model, Effect Msg )
refreshSource model =
    let
        name =
            repositoryName model
    in
    case repositorySourceControl model.repository of
        Just (SourceControl.Ready source) ->
            if SourceControl.busy source.activity then
                unchanged model

            else
                ( { model | repository = withSourceControl (SourceControl.Ready { source | activity = SourceControl.Refreshing }) model.repository }
                , Api.refreshSourceControl name (SourceLoaded name) (SourceFailed name)
                )

        Just (SourceControl.Unavailable requested _) ->
            ( { model | repository = withSourceControl (SourceControl.Loading requested) model.repository }
            , Api.refreshSourceControl name (SourceLoaded name) (SourceFailed name)
            )

        Just (SourceControl.Loading _) ->
            unchanged model

        Nothing ->
            unchanged model


updateReadySource : String -> Model -> (SourceControl.Snapshot -> ( Model, Effect Msg )) -> ( Model, Effect Msg )
updateReadySource requested model updateSource =
    case repositorySourceControl model.repository of
        Just (SourceControl.Ready source) ->
            if source.repository == requested then
                updateSource source

            else
                unchanged model

        _ ->
            unchanged model


unchanged : Model -> ( Model, Effect Msg )
unchanged model =
    ( model, Effect.none )


repositoryPath : Model -> RepositoryTab -> Maybe String -> String -> SearchMode -> PullRequestState -> String
repositoryPath model tab path query mode pullState =
    Route.toPath
        (Route.Repository
            { owner = model.location.owner
            , repository = model.location.repository
            , tab = tab
            , ref =
                if path == Nothing then
                    model.location.ref

                else
                    Just "HEAD"
            , path = path
            , query = query
            , searchMode = mode
            , pullState = pullState
            }
        )


toolbar : Model -> List (Html Msg)
toolbar model =
    [ div [ class "repository-identity" ]
        [ span [] [ text "Local repository" ]
        , strong [] [ text (repositoryName model) ]
        ]
    , div [ class "segmented repository-view-tabs", attribute "role" "group", attribute "aria-label" "Repository view" ]
        [ tabButton "Files" RepositoryFiles model.location.tab
        , tabButton "Pull requests" RepositoryPulls model.location.tab
        , tabButton "Commits" RepositoryCommits model.location.tab
        ]
    ]


tabButton : String -> RepositoryTab -> RepositoryTab -> Html Msg
tabButton label tab active =
    button
        [ type_ "button"
        , class ("segmented-button" ++ activeClass (tab == active))
        , onClick (SelectedTab tab)
        ]
        [ text label ]


searchForm : Model -> Html Msg
searchForm model =
    case readyState model of
        Just ready ->
            let
                mode =
                    RepositoryFiles.searchMode ready.files
            in
            form
                [ class ("repository-search" ++ activeClass (model.location.tab /= RepositoryFiles))
                , onSubmit SubmittedSearch
                ]
                [ div [ class "search-mode-picker", attribute "role" "group", attribute "aria-label" "Search mode" ]
                    [ searchModeButton "T" "Text" LiteralSearch mode
                    , searchModeButton ".*" "Regex" RegexSearch mode
                    , searchModeButton "F" "Fuzzy · FFF" FuzzySearch mode
                    ]
                , input
                    [ type_ "search"
                    , attribute "aria-label" "Search repository"
                    , placeholder "Search repository"
                    , value (RepositoryFiles.searchDraft ready.files)
                    , onInput ChangedSearch
                    ]
                    []
                , button [ type_ "submit", class "repository-search-submit" ] [ text "Search" ]
                ]

        Nothing ->
            text ""


searchModeButton : String -> String -> SearchMode -> SearchMode -> Html Msg
searchModeButton short labelText mode active =
    button
        [ type_ "button"
        , title labelText
        , attribute "aria-label" labelText
        , class ("search-mode-button" ++ activeClass (mode == active))
        , onClick (SelectedSearchMode mode)
        ]
        [ text short ]


view : Bool -> Model -> Html Msg
view syntaxHighlighting model =
    main_ [ class "repository-shell" ]
        [ if model.location.tab == RepositoryFiles then
            div [ class "repository-context-bar" ] [ searchForm model ]

          else
            text ""
        , sourceControlView model
        , case model.location.tab of
            RepositoryPulls ->
                pullsView model

            RepositoryCommits ->
                commitsView model

            RepositoryFiles ->
                filesView syntaxHighlighting model
        ]


sourceControlView : Model -> Html Msg
sourceControlView model =
    case repositorySourceControl model.repository of
        Just (SourceControl.Loading _) ->
            section [ class "repository-source-control", attribute "role" "status" ]
                [ span [ class "source-control-loading" ] [ text "Reading Git state…" ] ]

        Just (SourceControl.Unavailable _ error) ->
            section [ class "repository-source-control" ]
                [ span [ class "source-control-feedback is-error", attribute "role" "alert" ] [ text (ApiError.message error) ]
                , button [ type_ "button", onClick RequestedSourceRefresh ] [ text "Retry" ]
                ]

        Just (SourceControl.Ready source) ->
            sourceReady source

        Nothing ->
            text ""


sourceReady : SourceControl.Snapshot -> Html Msg
sourceReady source =
    let
        status =
            source.status

        branchState =
            case status.checkout of
                TrackingBranch checkout ->
                    { branch = checkout.name, ahead = checkout.ahead, behind = checkout.behind, canPull = checkout.behind > 0 }

                UntrackedBranch checkout ->
                    { branch = checkout.name, ahead = 0, behind = 0, canPull = False }

                DetachedHead _ ->
                    { branch = "", ahead = 0, behind = 0, canPull = False }

        busy =
            SourceControl.busy source.activity
    in
    section [ class "repository-source-control" ]
        [ label [ class "source-control-branch" ]
            [ span [] [ text "Branch" ]
            , select [ value branchState.branch, disabled busy, attribute "aria-label" "Checked-out repository branch", onInput SelectedBranch ]
                ((case status.checkout of
                    DetachedHead checkout ->
                        [ option [ value "" ] [ text ("Detached at " ++ String.left 7 checkout.oid) ] ]

                    _ ->
                        []
                 )
                    ++ List.map
                        (\candidate ->
                            option [ value candidate.name, selected (candidate.name == branchState.branch) ]
                                [ text
                                    (candidate.name
                                        ++ (if candidate.local then
                                                ""

                                            else
                                                " · remote"
                                           )
                                    )
                                ]
                        )
                        status.branches
                )
            ]
        , if branchState.ahead > 0 then
            span [ class "source-control-count is-ahead" ] [ text (String.fromInt branchState.ahead ++ " ↑") ]

          else
            text ""
        , if branchState.behind > 0 then
            span [ class "source-control-count is-behind" ] [ text (String.fromInt branchState.behind ++ " ↓") ]

          else
            text ""
        , span [ class "source-control-changes" ]
            [ text
                (String.fromInt status.staged
                    ++ " staged · "
                    ++ String.fromInt status.unstaged
                    ++ " changed · "
                    ++ String.fromInt status.untracked
                    ++ " untracked"
                )
            ]
        , sourceFeedback source.activity status.path
        , button
            [ type_ "button", class "source-control-refresh", disabled busy, attribute "aria-label" "Refresh repository source control", onClick RequestedSourceRefresh ]
            [ text "↻" ]
        , button [ type_ "button", class "source-control-pull", disabled (busy || not branchState.canPull), onClick RequestedPull ]
            [ text
                (case source.activity of
                    SourceControl.PullInFlight ->
                        "Pulling…"

                    SourceControl.PullSynchronizing count ->
                        SourceControl.pulledMessage count ++ " Refreshing status…"

                    _ ->
                        if branchState.behind > 0 then
                            "Pull " ++ String.fromInt branchState.behind ++ " ↓"

                        else
                            "Up to date"
                )
            ]
        ]


sourceFeedback : SourceControl.Activity -> String -> Html Msg
sourceFeedback action path =
    case action of
        SourceControl.Succeeded message ->
            span [ class "source-control-feedback is-success" ] [ text message ]

        _ ->
            span [ class "source-control-path" ] [ text path ]


filesView : Bool -> Model -> Html Msg
filesView syntaxHighlighting model =
    case model.repository of
        Missing missing ->
            cloneOffer missing.error missing.clone

        Resolving _ ->
            pageState "Reading repository files…" "Using the current local checkout without switching other tabs."

        Failed _ error ->
            pageState "Could not read this repository" (ApiError.message error)

        Ready ready ->
            let
                files =
                    RepositoryFiles.catalog ready.files
            in
            div [ class "repository-workspace" ]
                [ aside [ class "repository-file-sidebar" ]
                    [ header [] [ strong [] [ text "Files" ], span [ class "count-badge" ] [ text (String.fromInt (List.length files)) ] ]
                    , fileTree model ready.files (FileTree.build .path files)
                    ]
                , section [ class "repository-results" ]
                    [ case ready.view of
                        Files ->
                            case model.location.path of
                                Just _ ->
                                    repositoryFileView syntaxHighlighting model ready.files

                                Nothing ->
                                    if model.location.query /= "" then
                                        repositorySearchView model ready.files

                                    else
                                        div [ class "repository-empty-selection" ]
                                            [ h1 [] [ text "Choose a file" ]
                                            , p [] [ text "Browse the collapsed tree or search literal text, regular expressions, or FFF fuzzy matches." ]
                                            ]

                        _ ->
                            text ""
                    ]
                ]


fileTree : Model -> RepositoryFiles.Model -> List (Tree File) -> Html Msg
fileTree model files forest =
    div [ class "file-tree" ] (List.map (fileTreeNode model files 0) forest)


fileTreeNode : Model -> RepositoryFiles.Model -> Int -> Tree File -> Html Msg
fileTreeNode model files depth tree =
    case tree of
        Folder name path children ->
            let
                collapsed =
                    RepositoryFiles.isFolderCollapsed path files
            in
            div [ class "file-tree-folder" ]
                [ button
                    [ type_ "button"
                    , class "folder-row"
                    , attribute "style" ("padding-left:" ++ String.fromInt (depth * 16 + 10) ++ "px")
                    , onClick (ToggledFolder path)
                    ]
                    [ span []
                        [ text
                            (if collapsed then
                                "›"

                             else
                                "⌄"
                            )
                        ]
                    , strong [] [ text name ]
                    , small [] [ text (String.fromInt (leafCount children)) ]
                    ]
                , if collapsed then
                    text ""

                  else
                    div [] (List.map (fileTreeNode model files (depth + 1)) children)
                ]

        Leaf name file ->
            button
                [ type_ "button"
                , class ("repository-file-row" ++ activeClass (model.location.path == Just file.path))
                , attribute "style" ("padding-left:" ++ String.fromInt (depth * 16 + 28) ++ "px")
                , onClick (SelectedFile file.path)
                ]
                [ span [ class ("file-status is-" ++ file.gitStatus) ] [ text (statusMark file.gitStatus) ]
                , strong [] [ text name ]
                , small [] [ text (formatSize file.size) ]
                ]


leafCount : List (Tree item) -> Int
leafCount forest =
    List.sum
        (List.map
            (\tree ->
                case tree of
                    Leaf _ _ ->
                        1

                    Folder _ _ children ->
                        leafCount children
            )
            forest
        )


repositoryFileView : Bool -> Model -> RepositoryFiles.Model -> Html Msg
repositoryFileView syntaxHighlighting model files =
    case RepositoryFiles.selectedFile files of
        Loading _ ->
            pageState ("Opening " ++ Maybe.withDefault "file" model.location.path ++ "…") ""

        Failure _ error ->
            section [ class "page-state is-error" ] [ h1 [] [ text "Could not open file" ], p [] [ text (ApiError.message error) ] ]

        Success _ file ->
            section [ class "repository-file-view" ]
                [ div [ class "repository-file-heading" ]
                    [ button [ type_ "button", class "commit-back", onClick ClosedFile ]
                        [ text
                            (if model.location.query == "" then
                                "← File list"

                             else
                                "← Search results"
                            )
                        ]
                    , strong [] [ text file.path ]
                    , if file.truncated then
                        span [] [ text "First 500k characters shown" ]

                      else
                        text ""
                    ]
                , pre [ class "repository-source" ]
                    [ code []
                        (file.content
                            |> String.lines
                            |> List.indexedMap
                                (\index sourceLine ->
                                    span [ class "source-line" ]
                                        [ span [ class "line-number" ] [ text (String.fromInt (index + 1)) ]
                                        , span [ class "line-code" ] (Syntax.line syntaxHighlighting file.path sourceLine)
                                        ]
                                )
                        )
                    ]
                ]

        NotAsked ->
            text ""


repositorySearchView : Model -> RepositoryFiles.Model -> Html Msg
repositorySearchView model files =
    case RepositoryFiles.search files of
        Loading _ ->
            pageState ("Searching for “" ++ model.location.query ++ "”…") (searchDescription model.location.searchMode)

        Failure _ error ->
            section [ class "page-state is-error" ] [ h1 [] [ text "Search failed" ], p [] [ text (ApiError.message error) ] ]

        Success _ results ->
            div [ class "repository-search-results" ]
                [ section []
                    [ h2 [] [ text ("Filename matches · " ++ String.fromInt (List.length results.files)) ]
                    , div [ class "repository-filename-results" ]
                        (List.map
                            (\file ->
                                button [ type_ "button", class "repository-file-row", onClick (SelectedFile file.path) ]
                                    [ strong [] [ text file.path ] ]
                            )
                            results.files
                        )
                    ]
                , section []
                    [ h2 [] [ text ("Content matches · " ++ String.fromInt (List.length results.matches)) ]
                    , div [ class "repository-content-results" ]
                        (List.map searchMatchView results.matches)
                    ]
                ]

        NotAsked ->
            text ""


searchMatchView : Repository.SearchMatch -> Html Msg
searchMatchView match =
    button [ type_ "button", class "repository-search-match", onClick (SelectedFile match.path) ]
        [ span [ class "repository-match-heading" ]
            [ strong [] [ text match.path ], code [] [ text (":" ++ String.fromInt match.line) ] ]
        , pre []
            [ code []
                [ text
                    (String.join "\n"
                        (match.contextBefore ++ [ match.lineContent ] ++ match.contextAfter)
                    )
                ]
            ]
        ]


commitsView : Model -> Html Msg
commitsView model =
    case repositoryView model.repository of
        Just (Commits remote) ->
            case remote of
                Loading _ ->
                    pageState "Loading commits…" "Reading immutable OIDs from the local checkout."

                Failure _ error ->
                    section [ class "page-state is-error" ] [ h1 [] [ text "Could not load commits" ], p [] [ text (ApiError.message error) ] ]

                Success _ data ->
                    section [ class "commits-browser repository-commits-browser" ]
                        [ header [ class "commits-heading" ]
                            [ div [] [ h2 [] [ text ("Commits on " ++ data.ref) ], p [] [ text "Select an immutable commit to open its diff." ] ]
                            , span []
                                [ text
                                    (String.fromInt (List.length data.commits)
                                        ++ (if data.shallow then
                                                " · shallow"

                                            else
                                                ""
                                           )
                                    )
                                ]
                            ]
                        , div [ class "commit-list" ] (List.map commitRow data.commits)
                        ]

                NotAsked ->
                    text ""

        _ ->
            text ""


commitRow : Commit -> Html Msg
commitRow commit =
    button [ type_ "button", class "commit-row repository-commit-row", onClick (SelectedCommit commit) ]
        [ span [ class "commit-avatar" ] [ text (String.left 2 (String.toUpper commit.authorName)) ]
        , span [ class "commit-copy" ]
            [ strong [] [ text commit.subject ]
            , span [] [ text (commit.authorName ++ " · " ++ commit.authoredAt) ]
            ]
        , span [ class "commit-action" ]
            [ code [ class "commit-sha" ] [ text (String.left 7 commit.sha) ]
            , span [ class "commit-open-arrow" ] [ text "→" ]
            ]
        ]


pullsView : Model -> Html Msg
pullsView model =
    case repositoryView model.repository of
        Just (PullRequests pulls) ->
            section [ class "repository-pulls-browser" ]
                [ header [ class "repository-pulls-heading" ]
                    [ div []
                        [ span [] [ text "GitHub" ]
                        , h1 [] [ text ("Pull requests for " ++ repositoryName model) ]
                        , p [] [ text "Open a pull request directly in Hunker’s diff view." ]
                        ]
                    , div [ class "segmented repository-pull-filters" ]
                        (List.map (pullFilter model.location.pullState) [ OpenPulls, ClosedPulls, AllPulls ])
                    ]
                , case RepositoryPulls.request pulls of
                    Loading _ ->
                        if List.isEmpty (RepositoryPulls.rows pulls) then
                            pageState "Loading pull requests…" "Reading pull requests through your GitHub login."

                        else
                            pullRowsView model pulls True

                    Failure _ error ->
                        if List.isEmpty (RepositoryPulls.rows pulls) then
                            section [ class "page-state is-error" ] [ h1 [] [ text "Could not load pull requests" ], p [] [ text (ApiError.message error) ] ]

                        else
                            div [] [ pullRowsView model pulls False, p [ class "repository-pull-page-error" ] [ text (ApiError.message error) ] ]

                    Success _ _ ->
                        pullRowsView model pulls False

                    NotAsked ->
                        text ""
                ]

        _ ->
            text ""


pullFilter : PullRequestState -> PullRequestState -> Html Msg
pullFilter active state =
    button [ type_ "button", class ("segmented-button" ++ activeClass (active == state)), onClick (SelectedPullState state) ]
        [ text
            (case state of
                AllPulls ->
                    "All"

                ClosedPulls ->
                    "Closed"

                OpenPulls ->
                    "Open"
            )
        ]


pullRowsView : Model -> RepositoryPulls.Model -> Bool -> Html Msg
pullRowsView model pulls loading =
    div [ class "repository-pull-list" ]
        (List.map (pullRow model) (RepositoryPulls.rows pulls)
            ++ (if RepositoryPulls.hasMore pulls then
                    [ button [ type_ "button", class "repository-pull-load-more", disabled loading, onClick RequestedMorePulls ]
                        [ text
                            (if loading then
                                "Loading more…"

                             else
                                "Load more"
                            )
                        ]
                    ]

                else
                    []
               )
        )


pullRow : Model -> PullRequest -> Html Msg
pullRow model pull =
    a
        [ class "repository-pull-row"
        , href
            ("/"
                ++ Url.percentEncode model.location.owner
                ++ "/"
                ++ Url.percentEncode model.location.repository
                ++ "/pull/"
                ++ String.fromInt pull.number
                ++ "/files"
            )
        ]
        [ if pull.avatarUrl == "" then
            span [ class "repository-pull-avatar" ] [ text (String.left 2 (String.toUpper pull.author)) ]

          else
            img [ class "repository-pull-avatar", src pull.avatarUrl, attribute "alt" "" ] []
        , span [ class "repository-pull-copy" ]
            [ span [ class "repository-pull-title" ] [ strong [] [ text pull.title ], code [] [ text ("#" ++ String.fromInt pull.number) ] ]
            , small [] [ text (pull.author ++ " · " ++ pull.head ++ " → " ++ pull.base) ]
            , span [ class "repository-pull-labels" ] (List.map (\tag -> span [] [ text tag ]) pull.labels)
            ]
        , span [ class ("repository-pull-state is-" ++ pull.state) ]
            [ text
                (if pull.draft then
                    "Draft"

                 else
                    titleCase pull.state
                )
            ]
        , span [ class "commit-open-arrow" ] [ text "→" ]
        ]


cloneOffer : ApiError -> CloneState -> Html Msg
cloneOffer error clone =
    section [ class "repository-clone-offer" ]
        [ span [ class "repository-clone-mark" ] [ text "git" ]
        , h1 [] [ text "Clone this repository for local browsing" ]
        , p [] [ text (ApiError.message error) ]
        , cloneFeedback clone
        , div [ class "repository-clone-actions" ]
            [ button [ type_ "button", disabled (isCloneLoading clone), onClick (RequestedClone "temporary") ] [ text "Clone to /tmp" ]
            , button [ type_ "button", disabled (isCloneLoading clone), onClick (RequestedClone "configured") ] [ text "Clone to repos root" ]
            ]
        , small [] [ text "Clones start shallow and use your local GitHub authentication for private repositories." ]
        ]


cloneFeedback : CloneState -> Html Msg
cloneFeedback clone =
    case clone of
        CloneInFlight _ ->
            p [ class "repository-clone-feedback" ] [ text "Cloning…" ]

        CloneFailure _ error ->
            p [ class "repository-clone-error" ] [ text (ApiError.message error) ]

        CloneIdle ->
            text ""


isCloneLoading : CloneState -> Bool
isCloneLoading clone =
    case clone of
        CloneInFlight _ ->
            True

        _ ->
            False


pageState : String -> String -> Html Msg
pageState heading detail =
    section [ class "page-state" ] [ span [ class "loading-spinner" ] [], h1 [] [ text heading ], p [] [ text detail ] ]


statusMark : String -> String
statusMark status =
    if status == "clean" || status == "" then
        "·"

    else
        String.left 1 status


formatSize : Int -> String
formatSize size =
    if size > 1000000 then
        String.fromInt (size // 1000000) ++ " MB"

    else if size > 1000 then
        String.fromInt (size // 1000) ++ " KB"

    else
        String.fromInt size ++ " B"


searchDescription : SearchMode -> String
searchDescription mode =
    case mode of
        FuzzySearch ->
            "Ranking filenames with FFF and scanning nearby content."

        RegexSearch ->
            "Matching a regular expression with ripgrep."

        LiteralSearch ->
            "Matching literal text with ripgrep."


activeClass : Bool -> String
activeClass active =
    if active then
        " is-active"

    else
        ""


titleCase : String -> String
titleCase value =
    String.left 1 (String.toUpper value) ++ String.dropLeft 1 value
