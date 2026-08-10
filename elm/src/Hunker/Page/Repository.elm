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
import Hunker.Route as Route exposing (PullRequestState(..), RepositoryTab(..), SearchMode(..))
import Hunker.Syntax as Syntax
import Set exposing (Set)
import Time
import Url


type alias Model =
    { location : Route.RepositoryLocation
    , repository : RepositoryState
    , collapsedFolders : Set String
    , searchDraft : String
    , searchMode : SearchMode
    }


type RepositoryState
    = RepositoryLoading RepositoryRequest RepositoryView SourceControl
    | RepositoryFailed RepositoryRequest ApiError RepositoryView SourceControl CloneState
    | RepositoryReady ReadyRepository


type RepositoryRequest
    = RepositoryRequest String


type alias ReadyRepository =
    { request : RepositoryRequest
    , files : List File
    , view : RepositoryView
    , sourceControl : SourceControl
    }


type RepositoryView
    = Files FilesState
    | Commits (Remote RepositoryRequest ApiError Repository.Commits)
    | PullRequests PullRequestsState


type alias FilesState =
    { selectedFile : Remote FileRequest ApiError FileContent
    , search : Remote SearchRequest ApiError SearchResults
    }


type FileRequest
    = FileRequest String String


type SearchRequest
    = SearchRequest String String SearchMode


type PullRequestIdentity
    = PullRequestIdentity String PullRequestState Int


type alias PullRequestsState =
    { request : Remote PullRequestIdentity ApiError PullRequestsPage
    , rows : List Repository.PullRequest
    , hasMore : Bool
    }


type CloneState
    = CloneIdle
    | CloneInFlight CloneRequest
    | CloneFailure CloneRequest ApiError


type CloneRequest
    = CloneRequest String String


type SourceControl
    = SourceLoading String
    | SourceUnavailable String ApiError
    | SourceReady SourceSnapshot


type alias SourceSnapshot =
    { repository : String
    , status : SourceControlStatus
    , activity : SourceActivity
    }


type SourceActivity
    = SourceIdle
    | SourceRefreshing
    | BranchSwitching String
    | PullInFlight
    | PullSynchronizing Int
    | SourceSucceeded String


type Msg
    = FilesLoaded String (List File)
    | FilesFailed String ApiError
    | FileLoaded FileRequest FileContent
    | FileFailed FileRequest ApiError
    | SearchLoaded SearchRequest SearchResults
    | SearchFailed SearchRequest ApiError
    | CommitsLoaded RepositoryRequest Repository.Commits
    | CommitsFailed RepositoryRequest ApiError
    | PullsLoaded PullRequestIdentity PullRequestsPage
    | PullsFailed PullRequestIdentity ApiError
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

        viewState =
            initialView name location

        model =
            { location = location
            , repository = RepositoryLoading request viewState (SourceLoading name)
            , collapsedFolders = Set.empty
            , searchDraft = location.query
            , searchMode = location.searchMode
            }

        effects =
            [ Api.fetchRepositoryFiles name (FilesLoaded name) (FilesFailed name)
            , Api.refreshSourceControl name (SourceLoaded name) (SourceFailed name)
            , loadView viewState
            ]
    in
    ( model, Effect.batch effects )


initialView : String -> Route.RepositoryLocation -> RepositoryView
initialView name location =
    case location.tab of
        RepositoryFiles ->
            Files
                { selectedFile =
                    case location.path of
                        Just path ->
                            Loading (FileRequest name path)

                        Nothing ->
                            NotAsked
                , search =
                    if location.query == "" then
                        NotAsked

                    else
                        Loading (SearchRequest name location.query location.searchMode)
                }

        RepositoryCommits ->
            Commits (Loading (RepositoryRequest name))

        RepositoryPulls ->
            PullRequests
                { request = Loading (PullRequestIdentity name location.pullState 1)
                , rows = []
                , hasMore = False
                }


loadView : RepositoryView -> Effect Msg
loadView viewState =
    case viewState of
        Files files ->
            Effect.batch
                [ case files.selectedFile of
                    Loading (FileRequest name path) ->
                        Api.fetchRepositoryFile name path (FileLoaded (FileRequest name path)) (FileFailed (FileRequest name path))

                    _ ->
                        Effect.none
                , case files.search of
                    Loading (SearchRequest name query mode) ->
                        Api.searchRepository name query (Route.searchModeToString mode) (SearchLoaded (SearchRequest name query mode)) (SearchFailed (SearchRequest name query mode))

                    _ ->
                        Effect.none
                ]

        Commits (Loading request) ->
            Api.fetchRepositoryCommits (repositoryRequestName request) (CommitsLoaded request) (CommitsFailed request)

        Commits _ ->
            Effect.none

        PullRequests pulls ->
            case pulls.request of
                Loading request ->
                    loadPullRequests request

                _ ->
                    Effect.none


loadPullRequests : PullRequestIdentity -> Effect Msg
loadPullRequests request =
    case request of
        PullRequestIdentity name pullState page ->
            Api.fetchRepositoryPulls name
                (Route.pullRequestStateToString pullState)
                page
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
        in
        ( { model
            | location = nextLocation
            , repository = mapRepositoryView (always nextView) model.repository
            , collapsedFolders = revealLocationPath nextLocation.path model
            , searchDraft = nextLocation.query
            , searchMode = nextLocation.searchMode
          }
        , loadView nextView
        )


revealLocationPath : Maybe String -> Model -> Set String
revealLocationPath maybePath model =
    case ( maybePath, repositoryFiles model.repository ) of
        ( Just path, Just files ) ->
            model.collapsedFolders
                |> Set.toList
                |> FileTree.reveal path
                |> Set.fromList

        _ ->
            model.collapsedFolders


repositoryName : Model -> String
repositoryName model =
    model.location.owner ++ "/" ++ model.location.repository


repositoryRequestName : RepositoryRequest -> String
repositoryRequestName (RepositoryRequest name) =
    name


repositoryFiles : RepositoryState -> Maybe (List File)
repositoryFiles state =
    case state of
        RepositoryReady ready ->
            Just ready.files

        _ ->
            Nothing


repositoryView : RepositoryState -> RepositoryView
repositoryView state =
    case state of
        RepositoryLoading _ current _ ->
            current

        RepositoryFailed _ _ current _ _ ->
            current

        RepositoryReady ready ->
            ready.view


mapRepositoryView : (RepositoryView -> RepositoryView) -> RepositoryState -> RepositoryState
mapRepositoryView transform state =
    case state of
        RepositoryLoading request current source ->
            RepositoryLoading request (transform current) source

        RepositoryFailed request error current source clone ->
            RepositoryFailed request error (transform current) source clone

        RepositoryReady ready ->
            RepositoryReady { ready | view = transform ready.view }


repositorySourceControl : RepositoryState -> SourceControl
repositorySourceControl state =
    case state of
        RepositoryLoading _ _ source ->
            source

        RepositoryFailed _ _ _ source _ ->
            source

        RepositoryReady ready ->
            ready.sourceControl


withSourceControl : SourceControl -> RepositoryState -> RepositoryState
withSourceControl source state =
    case state of
        RepositoryLoading request current _ ->
            RepositoryLoading request current source

        RepositoryFailed request error current _ clone ->
            RepositoryFailed request error current source clone

        RepositoryReady ready ->
            RepositoryReady { ready | sourceControl = source }


mapFilesView : (FilesState -> FilesState) -> RepositoryState -> RepositoryState
mapFilesView transform =
    mapRepositoryView
        (\current ->
            case current of
                Files files ->
                    Files (transform files)

                _ ->
                    current
        )


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


mapPullsView : (PullRequestsState -> PullRequestsState) -> RepositoryState -> RepositoryState
mapPullsView transform =
    mapRepositoryView
        (\current ->
            case current of
                PullRequests pulls ->
                    PullRequests (transform pulls)

                _ ->
                    current
        )


currentFileRequest : Model -> FileRequest
currentFileRequest model =
    FileRequest (repositoryName model) (Maybe.withDefault "" model.location.path)


currentSearchRequest : Model -> SearchRequest
currentSearchRequest model =
    SearchRequest (repositoryName model) model.location.query model.location.searchMode


currentPullRequest : Model -> Int -> PullRequestIdentity
currentPullRequest model page =
    PullRequestIdentity (repositoryName model) model.location.pullState page


pullPage : Remote PullRequestIdentity error value -> Int
pullPage remote =
    case remote of
        Loading (PullRequestIdentity _ _ page) ->
            page

        Failure (PullRequestIdentity _ _ page) _ ->
            page

        Success (PullRequestIdentity _ _ page) _ ->
            page

        NotAsked ->
            0


cloneRequestRepository : CloneRequest -> String
cloneRequestRepository (CloneRequest name _) =
    name


isActivePullRequest : PullRequestIdentity -> RepositoryState -> Bool
isActivePullRequest request state =
    case repositoryView state of
        PullRequests pulls ->
            Remote.identity pulls.request == Just request

        _ ->
            False


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
                    tree =
                        FileTree.build .path files
                in
                ( { model
                    | repository =
                        case model.repository of
                            RepositoryLoading request current source ->
                                RepositoryReady
                                    { request = request
                                    , files = files
                                    , view = current
                                    , sourceControl = source
                                    }

                            RepositoryReady ready ->
                                RepositoryReady { ready | files = files }

                            RepositoryFailed request _ current source _ ->
                                RepositoryReady
                                    { request = request
                                    , files = files
                                    , view = current
                                    , sourceControl = source
                                    }
                    , collapsedFolders =
                        case model.location.path of
                            Nothing ->
                                Set.fromList (FileTree.directoryPaths tree)

                            Just path ->
                                Set.fromList (FileTree.directoryPaths tree)
                                    |> Set.toList
                                    |> FileTree.reveal path
                                    |> Set.fromList
                  }
                , Effect.none
                )

        FilesFailed requested error ->
            if requested == repositoryName model then
                ( { model
                    | repository =
                        case model.repository of
                            RepositoryLoading request current source ->
                                RepositoryFailed request error current source CloneIdle

                            RepositoryFailed request _ current source clone ->
                                RepositoryFailed request error current source clone

                            RepositoryReady ready ->
                                RepositoryFailed ready.request error ready.view ready.sourceControl CloneIdle
                  }
                , Effect.none
                )

            else
                unchanged model

        FileLoaded request file ->
            if request == currentFileRequest model then
                ( { model | repository = mapFilesView (\files -> { files | selectedFile = Success request file }) model.repository }, Effect.none )

            else
                unchanged model

        FileFailed request error ->
            if request == currentFileRequest model then
                ( { model | repository = mapFilesView (\files -> { files | selectedFile = Failure request error }) model.repository }, Effect.none )

            else
                unchanged model

        SearchLoaded request results ->
            if request == currentSearchRequest model then
                ( { model | repository = mapFilesView (\files -> { files | search = Success request results }) model.repository }, Effect.none )

            else
                unchanged model

        SearchFailed request error ->
            if request == currentSearchRequest model then
                ( { model | repository = mapFilesView (\files -> { files | search = Failure request error }) model.repository }, Effect.none )

            else
                unchanged model

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
            if not (isActivePullRequest request model.repository) then
                unchanged model

            else
                ( { model
                    | repository =
                        mapPullsView
                            (\pulls ->
                                { request = Success request page
                                , rows =
                                    if page.page == 1 then
                                        page.pullRequests

                                    else
                                        pulls.rows ++ page.pullRequests
                                , hasMore = page.hasMore
                                }
                            )
                            model.repository
                  }
                , Effect.none
                )

        PullsFailed request error ->
            if isActivePullRequest request model.repository then
                ( { model | repository = mapPullsView (\pulls -> { pulls | request = Failure request error }) model.repository }, Effect.none )

            else
                unchanged model

        SourceLoaded requested status ->
            if requested == repositoryName model then
                ( { model
                    | repository =
                        withSourceControl
                            (SourceReady
                                { repository = requested
                                , status = status
                                , activity = SourceIdle
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
                                (SourceReady { source | activity = PullSynchronizing count })
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
                            (SourceReady
                                { repository = requested
                                , status = status
                                , activity = SourceSucceeded (pulledMessage count)
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
                            (SourceUnavailable requested
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
                ( { model | repository = withSourceControl (SourceUnavailable requested error) model.repository }, Effect.none )

            else
                unchanged model

        CloneLoaded request _ ->
            if cloneRequestRepository request /= repositoryName model then
                unchanged model

            else
                let
                    name =
                        repositoryName model

                    requestIdentity =
                        RepositoryRequest name

                    nextView =
                        initialView name model.location
                in
                ( { model
                    | repository =
                        RepositoryLoading requestIdentity nextView (SourceLoading name)
                  }
                , Effect.batch
                    [ Api.fetchRepositoryFiles name (FilesLoaded name) (FilesFailed name)
                    , Api.refreshSourceControl name (SourceLoaded name) (SourceFailed name)
                    , loadView nextView
                    ]
                )

        CloneFailed request error ->
            if cloneRequestRepository request == repositoryName model then
                case model.repository of
                    RepositoryFailed repositoryRequest repositoryError current source _ ->
                        ( { model | repository = RepositoryFailed repositoryRequest repositoryError current source (CloneFailure request error) }, Effect.none )

                    _ ->
                        unchanged model

            else
                unchanged model

        ChangedSearch query ->
            ( { model | searchDraft = query }, Effect.none )

        SelectedSearchMode mode ->
            ( { model | searchMode = mode }, Effect.none )

        SubmittedSearch ->
            ( model, Effect.PushUrl (repositoryPath model RepositoryFiles Nothing model.searchDraft model.searchMode model.location.pullState) )

        SelectedTab tab ->
            ( model, Effect.PushUrl (repositoryPath model tab Nothing "" LiteralSearch model.location.pullState) )

        SelectedFile path ->
            ( model, Effect.PushUrl (repositoryPath model RepositoryFiles (Just path) model.location.query model.location.searchMode model.location.pullState) )

        ClosedFile ->
            ( model, Effect.PushUrl (repositoryPath model RepositoryFiles Nothing model.location.query model.location.searchMode model.location.pullState) )

        ToggledFolder path ->
            ( { model
                | collapsedFolders =
                    if Set.member path model.collapsedFolders then
                        Set.remove path model.collapsedFolders

                    else
                        Set.insert path model.collapsedFolders
              }
            , Effect.none
            )

        SelectedPullState state ->
            ( model, Effect.PushUrl (repositoryPath model RepositoryPulls Nothing "" LiteralSearch state) )

        RequestedMorePulls ->
            case repositoryView model.repository of
                PullRequests pulls ->
                    let
                        page =
                            pullPage pulls.request + 1

                        request =
                            currentPullRequest model page
                    in
                    ( { model | repository = mapPullsView (\current -> { current | request = Loading request }) model.repository }
                    , loadPullRequests request
                    )

                _ ->
                    unchanged model

        SelectedBranch branch ->
            let
                name =
                    repositoryName model
            in
            updateReadySource name model <|
                \source ->
                    if sourceBusy source.activity then
                        unchanged model

                    else
                        ( { model | repository = withSourceControl (SourceReady { source | activity = BranchSwitching branch }) model.repository }
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
                    if sourceBusy source.activity || not (sourceCanPull source.status) then
                        unchanged model

                    else
                        ( { model | repository = withSourceControl (SourceReady { source | activity = PullInFlight }) model.repository }
                        , Api.pullRepository name (PullCompleted name) (SourceFailed name)
                        )

        RequestedClone destination ->
            let
                request =
                    CloneRequest (repositoryName model) destination
            in
            case model.repository of
                RepositoryFailed repositoryRequest error current source _ ->
                    ( { model | repository = RepositoryFailed repositoryRequest error current source (CloneInFlight request) }
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
        SourceReady source ->
            if sourceBusy source.activity then
                unchanged model

            else
                ( { model | repository = withSourceControl (SourceReady { source | activity = SourceRefreshing }) model.repository }
                , Api.refreshSourceControl name (SourceLoaded name) (SourceFailed name)
                )

        SourceUnavailable requested _ ->
            ( { model | repository = withSourceControl (SourceLoading requested) model.repository }
            , Api.refreshSourceControl name (SourceLoaded name) (SourceFailed name)
            )

        SourceLoading _ ->
            unchanged model


updateReadySource : String -> Model -> (SourceSnapshot -> ( Model, Effect Msg )) -> ( Model, Effect Msg )
updateReadySource requested model updateSource =
    case repositorySourceControl model.repository of
        SourceReady source ->
            if source.repository == requested then
                updateSource source

            else
                unchanged model

        _ ->
            unchanged model


sourceBusy : SourceActivity -> Bool
sourceBusy activity =
    case activity of
        SourceRefreshing ->
            True

        BranchSwitching _ ->
            True

        PullInFlight ->
            True

        PullSynchronizing _ ->
            True

        SourceIdle ->
            False

        SourceSucceeded _ ->
            False


sourceCanPull : SourceControlStatus -> Bool
sourceCanPull status =
    case status.checkout of
        TrackingBranch checkout ->
            checkout.behind > 0

        UntrackedBranch _ ->
            False

        DetachedHead _ ->
            False


pulledMessage : Int -> String
pulledMessage count =
    if count == 1 then
        "Pulled 1 commit."

    else
        "Pulled " ++ String.fromInt count ++ " commits."


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
    form
        [ class ("repository-search" ++ activeClass (model.location.tab /= RepositoryFiles))
        , onSubmit SubmittedSearch
        ]
        [ div [ class "search-mode-picker", attribute "role" "group", attribute "aria-label" "Search mode" ]
            [ searchModeButton "T" "Text" LiteralSearch model.searchMode
            , searchModeButton ".*" "Regex" RegexSearch model.searchMode
            , searchModeButton "F" "Fuzzy · FFF" FuzzySearch model.searchMode
            ]
        , input
            [ type_ "search"
            , attribute "aria-label" "Search repository"
            , placeholder "Search repository"
            , value model.searchDraft
            , onInput ChangedSearch
            ]
            []
        , button [ type_ "submit", class "repository-search-submit" ] [ text "Search" ]
        ]


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
        SourceLoading _ ->
            section [ class "repository-source-control", attribute "role" "status" ]
                [ span [ class "source-control-loading" ] [ text "Reading Git state…" ] ]

        SourceUnavailable _ error ->
            section [ class "repository-source-control" ]
                [ span [ class "source-control-feedback is-error", attribute "role" "alert" ] [ text (ApiError.message error) ]
                , button [ type_ "button", onClick RequestedSourceRefresh ] [ text "Retry" ]
                ]

        SourceReady source ->
            sourceReady source


sourceReady : SourceSnapshot -> Html Msg
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
            sourceBusy source.activity
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
                    PullInFlight ->
                        "Pulling…"

                    PullSynchronizing count ->
                        pulledMessage count ++ " Refreshing status…"

                    _ ->
                        if branchState.behind > 0 then
                            "Pull " ++ String.fromInt branchState.behind ++ " ↓"

                        else
                            "Up to date"
                )
            ]
        ]


sourceFeedback : SourceActivity -> String -> Html Msg
sourceFeedback action path =
    case action of
        SourceSucceeded message ->
            span [ class "source-control-feedback is-success" ] [ text message ]

        _ ->
            span [ class "source-control-path" ] [ text path ]


filesView : Bool -> Model -> Html Msg
filesView syntaxHighlighting model =
    case model.repository of
        RepositoryFailed _ error _ _ clone ->
            cloneOffer error clone

        RepositoryLoading _ _ _ ->
            pageState "Reading repository files…" "Using the current local checkout without switching other tabs."

        RepositoryReady ready ->
            div [ class "repository-workspace" ]
                [ aside [ class "repository-file-sidebar" ]
                    [ header [] [ strong [] [ text "Files" ], span [ class "count-badge" ] [ text (String.fromInt (List.length ready.files)) ] ]
                    , fileTree model (FileTree.build .path ready.files)
                    ]
                , section [ class "repository-results" ]
                    [ case ready.view of
                        Files files ->
                            case model.location.path of
                                Just _ ->
                                    repositoryFileView syntaxHighlighting model files

                                Nothing ->
                                    if model.location.query /= "" then
                                        repositorySearchView model files

                                    else
                                        div [ class "repository-empty-selection" ]
                                            [ h1 [] [ text "Choose a file" ]
                                            , p [] [ text "Browse the collapsed tree or search literal text, regular expressions, or FFF fuzzy matches." ]
                                            ]

                        _ ->
                            text ""
                    ]
                ]


fileTree : Model -> List (Tree File) -> Html Msg
fileTree model forest =
    div [ class "file-tree" ] (List.map (fileTreeNode model 0) forest)


fileTreeNode : Model -> Int -> Tree File -> Html Msg
fileTreeNode model depth tree =
    case tree of
        Folder name path children ->
            let
                collapsed =
                    Set.member path model.collapsedFolders
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
                    div [] (List.map (fileTreeNode model (depth + 1)) children)
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


repositoryFileView : Bool -> Model -> FilesState -> Html Msg
repositoryFileView syntaxHighlighting model files =
    case files.selectedFile of
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


repositorySearchView : Model -> FilesState -> Html Msg
repositorySearchView model files =
    case files.search of
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
        Commits remote ->
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
        PullRequests pulls ->
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
                , case pulls.request of
                    Loading _ ->
                        if List.isEmpty pulls.rows then
                            pageState "Loading pull requests…" "Reading pull requests through your GitHub login."

                        else
                            pullRowsView model pulls True

                    Failure _ error ->
                        if List.isEmpty pulls.rows then
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


pullRowsView : Model -> PullRequestsState -> Bool -> Html Msg
pullRowsView model pulls loading =
    div [ class "repository-pull-list" ]
        (List.map (pullRow model) pulls.rows
            ++ (if pulls.hasMore then
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
