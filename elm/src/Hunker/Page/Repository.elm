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

import Html exposing (Html, button, div, form, input, main_, text)
import Html.Attributes exposing (attribute, class, placeholder, title, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import Hunker.Api as Api
import Hunker.ApiError as ApiError exposing (ApiError)
import Hunker.Domain.Repository as Repository exposing (Checkout(..), Commit, File, FileContent, PullRequestsPage, SearchResults, SourceControlStatus)
import Hunker.Effect as Effect exposing (Effect)
import Hunker.Remote as Remote exposing (Remote(..))
import Hunker.Repository.Files as RepositoryFiles
import Hunker.Repository.Pulls as RepositoryPulls
import Hunker.Repository.Revision as RepositoryRevision
import Hunker.Repository.SourceControl as SourceControl
import Hunker.Repository.View.Commits as CommitsView
import Hunker.Repository.View.Files as FilesView
import Hunker.Repository.View.Local as LocalView
import Hunker.Repository.View.PullRequests as PullRequestsView
import Hunker.Repository.View.SourceControl as SourceControlView
import Hunker.Repository.View.Toolbar as ToolbarView
import Hunker.Route as Route exposing (PullRequestState(..), RepositoryTab(..), SearchMode(..))
import Time
import Url


type alias Model =
    { repository : RepositoryId
    , local : LocalRepositoryState
    , view : RepositoryView
    }


type RepositoryId
    = RepositoryId { owner : String, name : String }


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
    = Files FilesLocation FilesState
    | Commits CommitsLocation CommitsState
    | PullRequests PullsLocation PullsState


type alias FilesLocation =
    { ref : Maybe String
    , path : Maybe String
    , query : String
    , searchMode : SearchMode
    }


type alias CommitsLocation =
    { ref : Maybe String }


type alias PullsLocation =
    { state : PullRequestState }


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
    | ToggledSourceFold String
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
        repository =
            RepositoryId { owner = location.owner, name = location.repository }

        name =
            repositoryIdString repository

        viewState =
            initialView name location

        model =
            { repository = repository
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
            Files
                { ref = location.ref
                , path = location.path
                , query = location.query
                , searchMode = location.searchMode
                }
                FilesWaiting

        RepositoryCommits ->
            Commits { ref = location.ref } CommitsWaiting

        RepositoryPulls ->
            PullRequests { state = location.pullState } (PullsState (RepositoryPulls.init name location.pullState))


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
        PullRequests _ (PullsState pulls) ->
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
            /= repositoryOwner model.repository
            || nextLocation.repository
            /= repositoryShortName model.repository
    then
        init nextLocation

    else if nextLocation == repositoryLocation model then
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
                location =
                    filesLocation nextLocation

                files =
                    RepositoryFiles.navigate location.path location.query location.searchMode snapshot.files
            in
            ( { model
                | local = LocalReady { snapshot | files = files }
                , view = Files location FilesReady
              }
            , loadFiles files
            )

        ( RepositoryCommits, Just snapshot ) ->
            let
                identity =
                    snapshotIdentity snapshot
            in
            ( { model | view = Commits (commitsLocation nextLocation) (CommitsRemote (Loading identity)) }
            , Api.fetchRepositoryCommits name (oidString snapshot.headOid) (CommitsLoaded identity) (CommitsFailed identity)
            )

        ( RepositoryPulls, _ ) ->
            let
                pulls =
                    RepositoryPulls.init name nextLocation.pullState

                nextView =
                    PullRequests (pullsLocation nextLocation) (PullsState pulls)
            in
            ( { model | view = nextView }, loadRemoteView nextView )

        ( RepositoryFiles, Nothing ) ->
            ( { model | view = Files (filesLocation nextLocation) FilesWaiting }, Effect.none )

        ( RepositoryCommits, Nothing ) ->
            ( { model | view = Commits (commitsLocation nextLocation) CommitsWaiting }, Effect.none )


repositoryName : Model -> String
repositoryName model =
    repositoryIdString model.repository


repositoryIdString : RepositoryId -> String
repositoryIdString (RepositoryId value) =
    value.owner ++ "/" ++ value.name


repositoryOwner : RepositoryId -> String
repositoryOwner (RepositoryId value) =
    value.owner


repositoryShortName : RepositoryId -> String
repositoryShortName (RepositoryId value) =
    value.name


filesLocation : Route.RepositoryLocation -> FilesLocation
filesLocation location =
    { ref = location.ref
    , path = location.path
    , query = location.query
    , searchMode = location.searchMode
    }


commitsLocation : Route.RepositoryLocation -> CommitsLocation
commitsLocation location =
    { ref = location.ref }


pullsLocation : Route.RepositoryLocation -> PullsLocation
pullsLocation location =
    { state = location.pullState }


repositoryLocation : Model -> Route.RepositoryLocation
repositoryLocation model =
    let
        common details =
            { owner = repositoryOwner model.repository
            , repository = repositoryShortName model.repository
            , tab = details.tab
            , ref = details.ref
            , path = details.path
            , query = details.query
            , searchMode = details.searchMode
            , pullState = details.pullState
            }
    in
    case model.view of
        Files location _ ->
            common
                { tab = RepositoryFiles
                , ref = location.ref
                , path = location.path
                , query = location.query
                , searchMode = location.searchMode
                , pullState = OpenPulls
                }

        Commits location _ ->
            common
                { tab = RepositoryCommits
                , ref = location.ref
                , path = Nothing
                , query = ""
                , searchMode = LiteralSearch
                , pullState = OpenPulls
                }

        PullRequests location _ ->
            common
                { tab = RepositoryPulls
                , ref = Nothing
                , path = Nothing
                , query = ""
                , searchMode = LiteralSearch
                , pullState = location.state
                }


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
        Commits location (CommitsRemote commits) ->
            { model | view = Commits location (CommitsRemote (transform commits)) }

        _ ->
            model


mapPullsView : (RepositoryPulls.Model -> RepositoryPulls.Model) -> Model -> Model
mapPullsView transform model =
    case model.view of
        PullRequests location (PullsState pulls) ->
            { model | view = PullRequests location (PullsState (transform pulls)) }

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
                            activeLocation =
                                repositoryLocation model

                            repository =
                                snapshotRepository request.identity

                            oid =
                                snapshotOid request.identity

                            fileBrowser =
                                RepositoryFiles.init
                                    (RepositoryRevision.create
                                        (repositoryIdString repository)
                                        (oidString oid)
                                    )
                                    files
                                    activeLocation.path
                                    activeLocation.query
                                    activeLocation.searchMode

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
                        activateLocation activeLocation ready

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
                            (repositoryLocation model).pullState
                        )
                    )

                Nothing ->
                    unchanged model

        SelectedTab tab ->
            ( model, Effect.PushUrl (repositoryPath model tab Nothing "" LiteralSearch (repositoryLocation model).pullState) )

        SelectedFile path ->
            let
                current =
                    repositoryLocation model
            in
            ( model, Effect.PushUrl (repositoryPath model RepositoryFiles (Just path) current.query current.searchMode current.pullState) )

        ClosedFile ->
            let
                current =
                    repositoryLocation model
            in
            ( model, Effect.PushUrl (repositoryPath model RepositoryFiles Nothing current.query current.searchMode current.pullState) )

        ToggledFolder path ->
            ( mapFilesView (RepositoryFiles.toggleFolder path) model, Effect.none )

        ToggledSourceFold fold ->
            ( mapFilesView (RepositoryFiles.toggleSourceFold fold) model, Effect.none )

        SelectedPullState state ->
            ( model, Effect.PushUrl (repositoryPath model RepositoryPulls Nothing "" LiteralSearch state) )

        RequestedMorePulls ->
            case model.view of
                PullRequests _ (PullsState pulls) ->
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
                    ++ Url.percentEncode (repositoryOwner model.repository)
                    ++ "/"
                    ++ Url.percentEncode (repositoryShortName model.repository)
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

        updatedModel =
            model
                |> setViewRef (branchNameString branch)
                |> (\current -> { current | local = LocalResolving (LoadSnapshot request) })

        location =
            repositoryLocation updatedModel
    in
    ( updatedModel
    , Effect.batch
        [ Api.fetchRepositoryFiles
            (repositoryIdString repository)
            (oidString oid)
            (FilesLoaded request)
            (FilesFailed request)
        , Effect.ReplaceUrl (Route.toPath (Route.Repository location))
        ]
    )


setViewRef : String -> Model -> Model
setViewRef reference model =
    case model.view of
        Files location state ->
            { model | view = Files { location | ref = Just reference } state }

        Commits location state ->
            { model | view = Commits { location | ref = Just reference } state }

        PullRequests _ _ ->
            model


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
        current =
            repositoryLocation model

        activeRef =
            readySnapshot model
                |> Maybe.map (.branch >> branchNameString)
                |> Maybe.map Just
                |> Maybe.withDefault current.ref
    in
    Route.toPath
        (Route.Repository
            { owner = repositoryOwner model.repository
            , repository = repositoryShortName model.repository
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
    ToolbarView.view
        { repository = repositoryName model
        , activeTab = repositoryViewTab model.view
        , selectedTab = SelectedTab
        }


repositoryViewTab : RepositoryView -> RepositoryTab
repositoryViewTab repositoryView =
    case repositoryView of
        Files _ _ ->
            RepositoryFiles

        Commits _ _ ->
            RepositoryCommits

        PullRequests _ _ ->
            RepositoryPulls


searchForm : Model -> Html Msg
searchForm model =
    case readySnapshot model of
        Just snapshot ->
            let
                mode =
                    RepositoryFiles.searchMode snapshot.files
            in
            form
                [ class "repository-search"
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
        [ case model.view of
            Files _ _ ->
                div [ class "repository-context-bar" ] [ searchForm model ]

            _ ->
                text ""
        , SourceControlView.view
            { state = localSourceControl model
            , selectedBranch = SelectedBranch
            , requestedRefresh = RequestedSourceRefresh
            , requestedPull = RequestedPull
            }
        , case model.view of
            PullRequests location state ->
                pullsView location state model

            Commits location state ->
                commitsView location state model

            Files location _ ->
                filesView syntaxHighlighting location model
        ]


filesView : Bool -> FilesLocation -> Model -> Html Msg
filesView syntaxHighlighting location model =
    FilesView.view { state = filesViewState syntaxHighlighting location model }


filesViewState : Bool -> FilesLocation -> Model -> FilesView.State Msg
filesViewState syntaxHighlighting location model =
    case model.local of
        LocalReady snapshot ->
            FilesView.FilesReady
                { syntaxHighlighting = syntaxHighlighting
                , selectedPath = location.path
                , query = location.query
                , searchMode = location.searchMode
                , files = snapshot.files
                , selectedFile = SelectedFile
                , closedFile = ClosedFile
                , toggledFolder = ToggledFolder
                , toggledSourceFold = ToggledSourceFold
                }

        _ ->
            FilesView.LocalUnavailable (localUnavailable "Reading repository files…" model)


commitsView : CommitsLocation -> CommitsState -> Model -> Html Msg
commitsView location state model =
    CommitsView.view
        { state = commitsViewState state model
        , reference = location.ref
        , selectedCommit = SelectedCommit
        }


commitsViewState : CommitsState -> Model -> CommitsView.State SnapshotIdentity Msg
commitsViewState state model =
    case state of
        CommitsRemote remote ->
            CommitsView.CommitsRemote remote

        CommitsWaiting ->
            CommitsView.LocalUnavailable (localUnavailable "Loading commits…" model)


pullsView : PullsLocation -> PullsState -> Model -> Html Msg
pullsView location (PullsState pulls) model =
    PullRequestsView.view
        { repository = repositoryName model
        , owner = repositoryOwner model.repository
        , name = repositoryShortName model.repository
        , activeState = location.state
        , pulls = pulls
        , selectedState = SelectedPullState
        , requestedMore = RequestedMorePulls
        }


localUnavailable : String -> Model -> LocalView.Unavailable Msg
localUnavailable loadingMessage model =
    case model.local of
        LocalMissing missing ->
            LocalView.Missing (cloneOffer missing)

        LocalFailed _ error ->
            LocalView.Failed "Could not read this repository" error

        LocalResolving _ ->
            LocalView.Resolving loadingMessage "Resolving an immutable local Git revision."

        LocalReady _ ->
            LocalView.Resolving loadingMessage "Reading immutable OIDs from the local repository."


cloneOffer : MissingRepository -> LocalView.CloneOffer Msg
cloneOffer missing =
    { error = missing.error
    , loading =
        case missing.clone of
            CloneInFlight _ ->
                True

            _ ->
                False
    , feedback =
        case missing.clone of
            CloneInFlight _ ->
                Just (Ok "Cloning…")

            CloneFailure _ error ->
                Just (Err error)

            CloneIdle ->
                Nothing
    , cloneTemporary = RequestedClone "temporary"
    , cloneConfigured = RequestedClone "configured"
    }


activeClass : Bool -> String
activeClass active =
    if active then
        " is-active"

    else
        ""
