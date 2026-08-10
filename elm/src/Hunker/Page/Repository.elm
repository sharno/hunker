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
    , repository : RepositoryId
    , local : LocalRepositoryState
    , view : RepositoryView
    }


type RepositoryId
    = RepositoryId String


type BranchName
    = BranchName String


type Oid
    = Oid String


type LocalRepositoryState
    = LocalResolving LocalRequest
    | LocalMissing MissingRepository
    | LocalFailed LocalRequest ApiError
    | LocalReady RepositorySnapshot


type LocalRequest
    = DiscoverLocal RepositoryId
    | LoadSnapshot SnapshotRequest


type alias RepositorySnapshot =
    { repository : RepositoryId
    , branch : BranchName
    , headOid : Oid
    , files : RepositoryFiles.Model
    , sourceControl : SourceControl.State
    }


type alias SnapshotRequest =
    { identity : SnapshotIdentity
    , branch : BranchName
    , source : SourceControl.Snapshot
    , completion : SnapshotCompletion
    }


type SnapshotIdentity
    = SnapshotIdentity RepositoryId Oid


type SnapshotCompletion
    = InitialSnapshot
    | RefreshedSnapshot
    | SwitchedSnapshot BranchName
    | PulledSnapshot Int


type alias MissingRepository =
    { repository : RepositoryId
    , error : ApiError
    , clone : CloneState
    }


type RepositoryView
    = Files FilesState
    | Commits CommitsState
    | PullRequests PullsState


type FilesState
    = FilesWaiting
    | FilesReady


type CommitsState
    = CommitsWaiting
    | CommitsRemote (Remote SnapshotIdentity ApiError Repository.Commits)


type PullsState
    = PullsState RepositoryPulls.Model


type CloneState
    = CloneIdle
    | CloneInFlight CloneRequest
    | CloneFailure CloneRequest ApiError


type CloneRequest
    = CloneRequest RepositoryId String


type SourceRequest
    = DiscoverSource RepositoryId
    | RefreshSource SnapshotIdentity
    | SwitchSource SnapshotIdentity BranchName
    | PulledSource SnapshotIdentity Int


type Msg
    = FilesLoaded SnapshotRequest (List File)
    | FilesFailed SnapshotRequest ApiError
    | FileLoaded RepositoryFiles.FileRequest FileContent
    | FileFailed RepositoryFiles.FileRequest ApiError
    | SearchLoaded RepositoryFiles.SearchRequest SearchResults
    | SearchFailed RepositoryFiles.SearchRequest ApiError
    | CommitsLoaded SnapshotIdentity Repository.Commits
    | CommitsFailed SnapshotIdentity ApiError
    | PullsLoaded RepositoryPulls.Identity PullRequestsPage
    | PullsFailed RepositoryPulls.Identity ApiError
    | SourceLoaded SourceRequest SourceControlStatus
    | PullCompleted SnapshotIdentity Int
    | SourceFailed SourceRequest ApiError
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

        repository =
            RepositoryId name

        viewState =
            initialView name location

        model =
            { location = location
            , repository = repository
            , local = LocalResolving (DiscoverLocal repository)
            , view = viewState
            }
    in
    ( model
    , Effect.batch
        [ Api.refreshSourceControl name (SourceLoaded (DiscoverSource repository)) (SourceFailed (DiscoverSource repository))
        , loadRemoteView viewState
        ]
    )


initialView : String -> Route.RepositoryLocation -> RepositoryView
initialView name location =
    case location.tab of
        RepositoryFiles ->
            Files FilesWaiting

        RepositoryCommits ->
            Commits CommitsWaiting

        RepositoryPulls ->
            PullRequests (PullsState (RepositoryPulls.init name location.pullState))


loadFiles : RepositoryFiles.Model -> Effect Msg
loadFiles files =
    Effect.batch
        [ case RepositoryFiles.selectedFile files of
            Loading request ->
                Api.fetchRepositoryFile
                    (RepositoryFiles.fileRepository request)
                    (RepositoryFiles.fileOid request)
                    (RepositoryFiles.filePath request)
                    (FileLoaded request)
                    (FileFailed request)

            _ ->
                Effect.none
        , case RepositoryFiles.search files of
            Loading request ->
                Api.searchRepository
                    (RepositoryFiles.searchRepository request)
                    (RepositoryFiles.searchOid request)
                    (RepositoryFiles.searchQuery request)
                    (Route.searchModeToString (RepositoryFiles.requestSearchMode request))
                    (SearchLoaded request)
                    (SearchFailed request)

            _ ->
                Effect.none
        ]


loadRemoteView : RepositoryView -> Effect Msg
loadRemoteView viewState =
    case viewState of
        PullRequests (PullsState pulls) ->
            case RepositoryPulls.request pulls of
                Loading request ->
                    loadPullRequests request

                _ ->
                    Effect.none

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

    else if nextLocation == model.location then
        unchanged model

    else
        activateLocation nextLocation model


activateLocation : Route.RepositoryLocation -> Model -> ( Model, Effect Msg )
activateLocation nextLocation model =
    let
        name =
            repositoryName model
    in
    case ( nextLocation.tab, readySnapshot model ) of
        ( RepositoryFiles, Just snapshot ) ->
            let
                files =
                    RepositoryFiles.navigate nextLocation.path nextLocation.query nextLocation.searchMode snapshot.files
            in
            ( { model
                | location = nextLocation
                , local = LocalReady { snapshot | files = files }
                , view = Files FilesReady
              }
            , loadFiles files
            )

        ( RepositoryCommits, Just snapshot ) ->
            let
                identity =
                    snapshotIdentity snapshot
            in
            ( { model | location = nextLocation, view = Commits (CommitsRemote (Loading identity)) }
            , Api.fetchRepositoryCommits name (oidString snapshot.headOid) (CommitsLoaded identity) (CommitsFailed identity)
            )

        ( RepositoryPulls, _ ) ->
            let
                pulls =
                    RepositoryPulls.init name nextLocation.pullState

                nextView =
                    PullRequests (PullsState pulls)
            in
            ( { model | location = nextLocation, view = nextView }, loadRemoteView nextView )

        ( RepositoryFiles, Nothing ) ->
            ( { model | location = nextLocation, view = Files FilesWaiting }, Effect.none )

        ( RepositoryCommits, Nothing ) ->
            ( { model | location = nextLocation, view = Commits CommitsWaiting }, Effect.none )


repositoryName : Model -> String
repositoryName model =
    repositoryIdString model.repository


repositoryIdString : RepositoryId -> String
repositoryIdString (RepositoryId value) =
    value


branchNameString : BranchName -> String
branchNameString (BranchName value) =
    value


oidString : Oid -> String
oidString (Oid value) =
    value


snapshotIdentity : RepositorySnapshot -> SnapshotIdentity
snapshotIdentity snapshot =
    SnapshotIdentity snapshot.repository snapshot.headOid


readySnapshot : Model -> Maybe RepositorySnapshot
readySnapshot model =
    case model.local of
        LocalReady snapshot ->
            Just snapshot

        _ ->
            Nothing


mapSnapshot : (RepositorySnapshot -> RepositorySnapshot) -> Model -> Model
mapSnapshot transform model =
    case model.local of
        LocalReady snapshot ->
            { model | local = LocalReady (transform snapshot) }

        _ ->
            model


mapFilesView : (RepositoryFiles.Model -> RepositoryFiles.Model) -> Model -> Model
mapFilesView transform =
    mapSnapshot (\snapshot -> { snapshot | files = transform snapshot.files })


mapCommitsView : (Remote SnapshotIdentity ApiError Repository.Commits -> Remote SnapshotIdentity ApiError Repository.Commits) -> Model -> Model
mapCommitsView transform model =
    case model.view of
        Commits (CommitsRemote commits) ->
            { model | view = Commits (CommitsRemote (transform commits)) }

        _ ->
            model


mapPullsView : (RepositoryPulls.Model -> RepositoryPulls.Model) -> Model -> Model
mapPullsView transform model =
    case model.view of
        PullRequests (PullsState pulls) ->
            { model | view = PullRequests (PullsState (transform pulls)) }

        _ ->
            model


cloneRequestRepository : CloneRequest -> RepositoryId
cloneRequestRepository (CloneRequest repository _) =
    repository


localSourceControl : Model -> Maybe SourceControl.State
localSourceControl model =
    case model.local of
        LocalReady snapshot ->
            Just snapshot.sourceControl

        LocalResolving (LoadSnapshot request) ->
            Just (SourceControl.Ready request.source)

        LocalFailed (LoadSnapshot request) error ->
            Just (SourceControl.Unavailable (repositoryName model) error)

        _ ->
            Nothing


mapSourceControl : (SourceControl.State -> SourceControl.State) -> Model -> Model
mapSourceControl transform model =
    mapSnapshot (\snapshot -> { snapshot | sourceControl = transform snapshot.sourceControl }) model


subscriptions : Model -> Sub Msg
subscriptions _ =
    Time.every 120000 PollSourceControl


update : Msg -> Model -> ( Model, Effect Msg )
update msg model =
    case msg of
        FilesLoaded request files ->
            case model.local of
                LocalResolving (LoadSnapshot active) ->
                    if active.identity /= request.identity then
                        unchanged model

                    else
                        let
                            repository =
                                snapshotRepository request.identity

                            oid =
                                snapshotOid request.identity

                            fileBrowser =
                                RepositoryFiles.init
                                    (repositoryIdString repository)
                                    (oidString oid)
                                    files
                                    model.location.path
                                    model.location.query
                                    model.location.searchMode

                            source =
                                request.source

                            snapshot =
                                { repository = repository
                                , branch = request.branch
                                , headOid = oid
                                , files = fileBrowser
                                , sourceControl =
                                    SourceControl.Ready
                                        { source | activity = completedActivity request.completion }
                                }

                            ready =
                                { model | local = LocalReady snapshot }
                        in
                        activateLocation model.location ready

                _ ->
                    unchanged model

        FilesFailed request error ->
            case model.local of
                LocalResolving (LoadSnapshot active) ->
                    if active.identity == request.identity then
                        ( { model | local = LocalFailed (LoadSnapshot request) error }, Effect.none )

                    else
                        unchanged model

                _ ->
                    unchanged model

        FileLoaded request file ->
            ( mapFilesView (RepositoryFiles.fileLoaded request file) model, Effect.none )

        FileFailed request error ->
            ( mapFilesView (RepositoryFiles.fileFailed request error) model, Effect.none )

        SearchLoaded request results ->
            ( mapFilesView (RepositoryFiles.searchLoaded request results) model, Effect.none )

        SearchFailed request error ->
            ( mapFilesView (RepositoryFiles.searchFailed request error) model, Effect.none )

        CommitsLoaded requested commits ->
            ( mapCommitsView
                (\remote ->
                    if Remote.identity remote == Just requested then
                        Success requested commits

                    else
                        remote
                )
                model
            , Effect.none
            )

        CommitsFailed requested error ->
            ( mapCommitsView
                (\remote ->
                    if Remote.identity remote == Just requested then
                        Failure requested error

                    else
                        remote
                )
                model
            , Effect.none
            )

        PullsLoaded request page ->
            ( mapPullsView (RepositoryPulls.loaded request page) model, Effect.none )

        PullsFailed request error ->
            ( mapPullsView (RepositoryPulls.failed request error) model, Effect.none )

        SourceLoaded request status ->
            if sourceRequestMatches request model then
                beginSnapshot request status model

            else
                unchanged model

        PullCompleted requested count ->
            withReadySource model <|
                \snapshot source ->
                    if snapshotIdentity snapshot /= requested then
                        unchanged model

                    else
                        ( mapSourceControl
                            (always (SourceControl.Ready { source | activity = SourceControl.PullSynchronizing count }))
                            model
                        , Api.refreshSourceControl
                            (repositoryName model)
                            (SourceLoaded (PulledSource requested count))
                            (SourceFailed (PulledSource requested count))
                        )

        SourceFailed request error ->
            if not (sourceRequestMatches request model) then
                unchanged model

            else
                case request of
                    DiscoverSource repository ->
                        if ApiError.isNotFound error then
                            ( { model
                                | local =
                                    LocalMissing
                                        { repository = repository
                                        , error = error
                                        , clone = CloneIdle
                                        }
                              }
                            , Effect.none
                            )

                        else
                            ( { model | local = LocalFailed (DiscoverLocal repository) error }, Effect.none )

                    _ ->
                        ( mapSourceControl (always (SourceControl.Unavailable (repositoryName model) error)) model, Effect.none )

        CloneLoaded request _ ->
            if cloneRequestRepository request /= model.repository then
                unchanged model

            else
                let
                    sourceRequest =
                        DiscoverSource model.repository
                in
                ( { model | local = LocalResolving (DiscoverLocal model.repository) }
                , Api.refreshSourceControl (repositoryName model) (SourceLoaded sourceRequest) (SourceFailed sourceRequest)
                )

        CloneFailed request error ->
            if cloneRequestRepository request /= model.repository then
                unchanged model

            else
                case model.local of
                    LocalMissing missing ->
                        ( { model | local = LocalMissing { missing | clone = CloneFailure request error } }, Effect.none )

                    _ ->
                        unchanged model

        ChangedSearch query ->
            ( mapFilesView (RepositoryFiles.changeSearchDraft query) model, Effect.none )

        SelectedSearchMode mode ->
            ( mapFilesView (RepositoryFiles.selectSearchMode mode) model, Effect.none )

        SubmittedSearch ->
            case readySnapshot model of
                Just snapshot ->
                    ( model
                    , Effect.PushUrl
                        (repositoryPath model
                            RepositoryFiles
                            Nothing
                            (RepositoryFiles.searchDraft snapshot.files)
                            (RepositoryFiles.searchMode snapshot.files)
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
            ( mapFilesView (RepositoryFiles.toggleFolder path) model, Effect.none )

        SelectedPullState state ->
            ( model, Effect.PushUrl (repositoryPath model RepositoryPulls Nothing "" LiteralSearch state) )

        RequestedMorePulls ->
            case model.view of
                PullRequests (PullsState pulls) ->
                    case RepositoryPulls.more pulls of
                        Just ( updated, request ) ->
                            ( mapPullsView (always updated) model, loadPullRequests request )

                        Nothing ->
                            unchanged model

                _ ->
                    unchanged model

        SelectedBranch branch ->
            withReadySource model <|
                \snapshot source ->
                    if SourceControl.busy source.activity then
                        unchanged model

                    else
                        let
                            identity =
                                snapshotIdentity snapshot

                            selected =
                                BranchName branch
                        in
                        ( mapSourceControl (always (SourceControl.Ready { source | activity = SourceControl.BranchSwitching branch })) model
                        , Api.switchBranch
                            (repositoryName model)
                            branch
                            (SourceLoaded (SwitchSource identity selected))
                            (SourceFailed (SwitchSource identity selected))
                        )

        RequestedSourceRefresh ->
            refreshSource model

        RequestedPull ->
            withReadySource model <|
                \snapshot source ->
                    if SourceControl.busy source.activity || not (SourceControl.canPull source.status) then
                        unchanged model

                    else
                        let
                            identity =
                                snapshotIdentity snapshot
                        in
                        ( mapSourceControl (always (SourceControl.Ready { source | activity = SourceControl.PullInFlight })) model
                        , Api.pullRepository (repositoryName model) (PullCompleted identity) (SourceFailed (RefreshSource identity))
                        )

        RequestedClone destination ->
            let
                request =
                    CloneRequest model.repository destination
            in
            case model.local of
                LocalMissing missing ->
                    ( { model | local = LocalMissing { missing | clone = CloneInFlight request } }
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


beginSnapshot : SourceRequest -> SourceControlStatus -> Model -> ( Model, Effect Msg )
beginSnapshot sourceRequest status model =
    let
        ( branch, oid ) =
            checkoutRevision status.checkout

        repository =
            sourceRequestRepository sourceRequest

        completion =
            sourceRequestCompletion sourceRequest

        request =
            { identity = SnapshotIdentity repository oid
            , branch = branch
            , source =
                { repository = repositoryIdString repository
                , status = status
                , activity = loadingActivity completion
                }
            , completion = completion
            }

        currentLocation =
            model.location

        location =
            { currentLocation | ref = Just (branchNameString branch) }
    in
    ( { model | location = location, local = LocalResolving (LoadSnapshot request) }
    , Effect.batch
        [ Api.fetchRepositoryFiles
            (repositoryIdString repository)
            (oidString oid)
            (FilesLoaded request)
            (FilesFailed request)
        , Effect.ReplaceUrl (Route.toPath (Route.Repository location))
        ]
    )


checkoutRevision : Checkout -> ( BranchName, Oid )
checkoutRevision checkout =
    case checkout of
        TrackingBranch value ->
            ( BranchName value.name, Oid value.oid )

        UntrackedBranch value ->
            ( BranchName value.name, Oid value.oid )

        DetachedHead value ->
            ( BranchName value.oid, Oid value.oid )


sourceRequestRepository : SourceRequest -> RepositoryId
sourceRequestRepository request =
    case request of
        DiscoverSource repository ->
            repository

        RefreshSource (SnapshotIdentity repository _) ->
            repository

        SwitchSource (SnapshotIdentity repository _) _ ->
            repository

        PulledSource (SnapshotIdentity repository _) _ ->
            repository


sourceRequestCompletion : SourceRequest -> SnapshotCompletion
sourceRequestCompletion request =
    case request of
        DiscoverSource _ ->
            InitialSnapshot

        RefreshSource _ ->
            RefreshedSnapshot

        SwitchSource _ branch ->
            SwitchedSnapshot branch

        PulledSource _ count ->
            PulledSnapshot count


sourceRequestMatches : SourceRequest -> Model -> Bool
sourceRequestMatches request model =
    case request of
        DiscoverSource repository ->
            model.repository
                == repository
                && (case model.local of
                        LocalResolving (DiscoverLocal active) ->
                            active == repository

                        _ ->
                            False
                   )

        RefreshSource identity ->
            readySnapshot model |> Maybe.map ((==) identity << snapshotIdentity) |> Maybe.withDefault False

        SwitchSource identity _ ->
            readySnapshot model |> Maybe.map ((==) identity << snapshotIdentity) |> Maybe.withDefault False

        PulledSource identity _ ->
            readySnapshot model |> Maybe.map ((==) identity << snapshotIdentity) |> Maybe.withDefault False


snapshotRepository : SnapshotIdentity -> RepositoryId
snapshotRepository (SnapshotIdentity repository _) =
    repository


snapshotOid : SnapshotIdentity -> Oid
snapshotOid (SnapshotIdentity _ oid) =
    oid


loadingActivity : SnapshotCompletion -> SourceControl.Activity
loadingActivity completion =
    case completion of
        InitialSnapshot ->
            SourceControl.Refreshing

        RefreshedSnapshot ->
            SourceControl.Refreshing

        SwitchedSnapshot branch ->
            SourceControl.BranchSwitching (branchNameString branch)

        PulledSnapshot count ->
            SourceControl.PullSynchronizing count


completedActivity : SnapshotCompletion -> SourceControl.Activity
completedActivity completion =
    case completion of
        InitialSnapshot ->
            SourceControl.Idle

        RefreshedSnapshot ->
            SourceControl.Succeeded "Repository refreshed."

        SwitchedSnapshot branch ->
            SourceControl.Succeeded ("Switched to " ++ branchNameString branch ++ ".")

        PulledSnapshot count ->
            SourceControl.Succeeded (SourceControl.pulledMessage count)


withReadySource : Model -> (RepositorySnapshot -> SourceControl.Snapshot -> ( Model, Effect Msg )) -> ( Model, Effect Msg )
withReadySource model apply =
    case readySnapshot model of
        Just snapshot ->
            case snapshot.sourceControl of
                SourceControl.Ready source ->
                    apply snapshot source

                _ ->
                    unchanged model

        Nothing ->
            unchanged model


refreshSource : Model -> ( Model, Effect Msg )
refreshSource model =
    withReadySource model <|
        \snapshot source ->
            if SourceControl.busy source.activity then
                unchanged model

            else
                let
                    identity =
                        snapshotIdentity snapshot
                in
                ( mapSourceControl (always (SourceControl.Ready { source | activity = SourceControl.Refreshing })) model
                , Api.refreshSourceControl
                    (repositoryName model)
                    (SourceLoaded (RefreshSource identity))
                    (SourceFailed (RefreshSource identity))
                )


unchanged : Model -> ( Model, Effect Msg )
unchanged model =
    ( model, Effect.none )


repositoryPath : Model -> RepositoryTab -> Maybe String -> String -> SearchMode -> PullRequestState -> String
repositoryPath model tab path query mode pullState =
    let
        activeRef =
            readySnapshot model
                |> Maybe.map (.branch >> branchNameString)
                |> Maybe.map Just
                |> Maybe.withDefault model.location.ref
    in
    Route.toPath
        (Route.Repository
            { owner = model.location.owner
            , repository = model.location.repository
            , tab = tab
            , ref =
                if tab == RepositoryPulls then
                    Nothing

                else
                    activeRef
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
    case readySnapshot model of
        Just snapshot ->
            let
                mode =
                    RepositoryFiles.searchMode snapshot.files
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
                    , value (RepositoryFiles.searchDraft snapshot.files)
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
    case localSourceControl model of
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
    case model.local of
        LocalMissing missing ->
            cloneOffer missing.error missing.clone

        LocalResolving _ ->
            pageState "Reading repository files…" "Using the current local checkout without switching other tabs."

        LocalFailed _ error ->
            pageState "Could not read this repository" (ApiError.message error)

        LocalReady snapshot ->
            let
                files =
                    RepositoryFiles.catalog snapshot.files
            in
            div [ class "repository-workspace" ]
                [ aside [ class "repository-file-sidebar" ]
                    [ header [] [ strong [] [ text "Files" ], span [ class "count-badge" ] [ text (String.fromInt (List.length files)) ] ]
                    , fileTree model snapshot.files (FileTree.build .path files)
                    ]
                , section [ class "repository-results" ]
                    [ case model.view of
                        Files _ ->
                            case model.location.path of
                                Just _ ->
                                    repositoryFileView syntaxHighlighting model snapshot.files

                                Nothing ->
                                    if model.location.query /= "" then
                                        repositorySearchView model snapshot.files

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
    case model.view of
        Commits (CommitsRemote remote) ->
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

        Commits CommitsWaiting ->
            localUnavailableView model "Loading commits…"

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
    case model.view of
        PullRequests (PullsState pulls) ->
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


localUnavailableView : Model -> String -> Html Msg
localUnavailableView model loadingMessage =
    case model.local of
        LocalMissing missing ->
            cloneOffer missing.error missing.clone

        LocalFailed _ error ->
            pageState "Could not read this repository" (ApiError.message error)

        LocalResolving _ ->
            pageState loadingMessage "Resolving an immutable local Git revision."

        LocalReady _ ->
            pageState loadingMessage "Reading immutable OIDs from the local repository."


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
