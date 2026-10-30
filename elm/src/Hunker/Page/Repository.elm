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
import Html.Attributes exposing (attribute, class, classList, placeholder, title, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import Hunker.Api as Api
import Hunker.ApiError as ApiError exposing (ApiError)
import Hunker.Domain.Git as Git exposing (BranchName, RepositoryId)
import Hunker.Domain.Repository as Repository exposing (Checkout(..), Commit, File, FileContent, PullRequestState(..), PullRequestsPage, RepositoryRoot(..), SearchMode(..), SearchResults, SourceControlStatus)
import Hunker.Domain.Settings exposing (Feature)
import Hunker.Effect as Effect exposing (Effect)
import Hunker.Remote exposing (Remote(..))
import Hunker.Repository.Files as RepositoryFiles
import Hunker.Repository.Pulls as RepositoryPulls
import Hunker.Repository.Revision as Revision exposing (Revision)
import Hunker.Repository.SourceControl as SourceControl exposing (Activity(..), Operation(..), Outcome(..))
import Hunker.Repository.View.Commits as CommitsView
import Hunker.Repository.View.Files as FilesView
import Hunker.Repository.View.Local as LocalView
import Hunker.Repository.View.PullRequests as PullRequestsView
import Hunker.Repository.View.SourceControl as SourceControlView
import Hunker.Repository.View.Toolbar as ToolbarView exposing (Tab(..))
import Hunker.Route as Route exposing (FilesLocation, RepositoryLocation, RepositoryView(..), Search(..))
import Time


sourcePollMilliseconds : Float
sourcePollMilliseconds =
    120000


type alias Model =
    { repository : RepositoryId
    , local : LocalRepositoryState
    , view : ActiveView
    }


{-| Local availability is independent from the active view: GitHub-backed
pull requests stay usable whether or not a clone exists.
-}
type LocalRepositoryState
    = LocalResolving LocalRequest
    | LocalMissing MissingRepository
    | LocalFailed LocalRequest ApiError
    | LocalReady RepositorySnapshot


type LocalRequest
    = DiscoverLocal
    | LoadSnapshot SnapshotRequest


{-| An immutable, OID-keyed view of the local checkout.
-}
type alias RepositorySnapshot =
    { revision : Revision
    , files : RepositoryFiles.Model
    , sourceControl : SourceControl.Snapshot
    }


type alias SnapshotRequest =
    { revision : Revision
    , source : SourceControl.Snapshot
    , completion : SnapshotCompletion
    }


type SnapshotCompletion
    = InitialSnapshot
    | RefreshedSnapshot
    | PolledSnapshot
    | SwitchedSnapshot BranchName
    | PulledSnapshot Int


type alias MissingRepository =
    { error : ApiError
    , clone : CloneState
    }


type CloneState
    = CloneIdle
    | CloneInFlight CloneRequest
    | CloneFailure CloneRequest ApiError


type CloneRequest
    = CloneRequest RepositoryId RepositoryRoot


{-| Each view owns its route location together with its state.
-}
type ActiveView
    = Files FilesLocation
    | Commits (Maybe String) (Remote Revision ApiError Repository.Commits)
    | PullRequests PullRequestState RepositoryPulls.Model


{-| A source-control status request: the first discovery of a checkout, or
a check of a known snapshot that completes as `SnapshotCompletion`.
-}
type SourceRequest
    = DiscoverSource RepositoryId
    | SnapshotSource Revision SnapshotCompletion


type Msg
    = FilesLoaded SnapshotRequest (List File)
    | FilesFailed SnapshotRequest ApiError
    | FileLoaded RepositoryFiles.FileRequest FileContent
    | FileFailed RepositoryFiles.FileRequest ApiError
    | SearchLoaded RepositoryFiles.SearchRequest SearchResults
    | SearchFailed RepositoryFiles.SearchRequest ApiError
    | CommitsLoaded Revision Repository.Commits
    | CommitsFailed Revision ApiError
    | PullsLoaded RepositoryPulls.Identity PullRequestsPage
    | PullsFailed RepositoryPulls.Identity ApiError
    | SourceLoaded SourceRequest SourceControlStatus
    | SourceFailed SourceRequest ApiError
    | PullCompleted Revision Int
    | PullFailed Revision ApiError
    | CloneLoaded CloneRequest String
    | CloneFailed CloneRequest ApiError
    | ChangedSearch String
    | SelectedSearchMode SearchMode
    | SubmittedSearch
    | SelectedTab Tab
    | SelectedFile String
    | ClosedFile
    | ToggledFolder String
    | ToggledSourceFold String
    | SelectedPullState PullRequestState
    | RequestedMorePulls
    | SelectedBranch BranchName
    | RequestedSourceRefresh
    | RequestedPull
    | RequestedClone RepositoryRoot
    | SelectedCommit Commit
    | PollSourceControl Time.Posix


init : RepositoryLocation -> ( Model, Effect Msg )
init location =
    let
        ( activeView, viewEffect ) =
            enterView location.repository Nothing location.view
    in
    ( { repository = location.repository
      , local = LocalResolving DiscoverLocal
      , view = activeView
      }
    , Effect.batch [ discover location.repository, viewEffect ]
    )


discover : RepositoryId -> Effect Msg
discover repository =
    Api.refreshSourceControl repository (SourceLoaded (DiscoverSource repository)) (SourceFailed (DiscoverSource repository))


{-| Builds the view for a location. Views that read local Git wait for a
ready snapshot; pull requests come from GitHub and load immediately.
-}
enterView : RepositoryId -> Maybe RepositorySnapshot -> RepositoryView -> ( ActiveView, Effect Msg )
enterView repository snapshot location =
    case ( location, snapshot ) of
        ( FilesView files, _ ) ->
            ( Files files, Effect.none )

        ( CommitsView reference, Just ready ) ->
            ( Commits reference (Loading ready.revision)
            , Api.fetchRepositoryCommits ready.revision (CommitsLoaded ready.revision) (CommitsFailed ready.revision)
            )

        ( CommitsView reference, Nothing ) ->
            ( Commits reference NotAsked, Effect.none )

        ( PullsView state, _ ) ->
            let
                ( pulls, request ) =
                    RepositoryPulls.init repository state
            in
            ( PullRequests state pulls, loadPullRequests request )


loadPullRequests : RepositoryPulls.Identity -> Effect Msg
loadPullRequests request =
    Api.fetchRepositoryPulls
        (RepositoryPulls.identityRepository request)
        (RepositoryPulls.identityState request)
        (RepositoryPulls.identityPage request)
        (PullsLoaded request)
        (PullsFailed request)


fileRequests : List RepositoryFiles.Request -> Effect Msg
fileRequests requests =
    requests
        |> List.map
            (\request ->
                case request of
                    RepositoryFiles.OpenFile file ->
                        Api.fetchRepositoryFile
                            (RepositoryFiles.fileRequestRevision file)
                            (RepositoryFiles.fileRequestPath file)
                            (FileLoaded file)
                            (FileFailed file)

                    RepositoryFiles.RunSearch search ->
                        Api.searchRepository
                            (RepositoryFiles.searchRequestRevision search)
                            (RepositoryFiles.searchRequestQuery search)
                            (RepositoryFiles.searchRequestMode search)
                            (SearchLoaded search)
                            (SearchFailed search)
            )
        |> Effect.batch


navigate : RepositoryLocation -> Model -> ( Model, Effect Msg )
navigate nextLocation model =
    if nextLocation.repository /= model.repository then
        init nextLocation

    else if nextLocation == repositoryLocation model then
        unchanged model

    else
        activateView nextLocation.view model


activateView : RepositoryView -> Model -> ( Model, Effect Msg )
activateView location model =
    let
        snapshot =
            readySnapshot model

        ( activeView, viewEffect ) =
            enterView model.repository snapshot location
    in
    case ( activeView, snapshot ) of
        ( Files files, Just ready ) ->
            let
                ( browsed, requests ) =
                    RepositoryFiles.navigate files.path files.search ready.files
            in
            ( { model | view = activeView, local = LocalReady { ready | files = browsed } }, fileRequests requests )

        ( Files _, Nothing ) ->
            ( { model | view = activeView }, viewEffect )

        ( Commits _ _, _ ) ->
            ( { model | view = activeView }, viewEffect )

        ( PullRequests _ _, _ ) ->
            ( { model | view = activeView }, viewEffect )


repositoryName : Model -> String
repositoryName model =
    Git.repositoryToString model.repository


{-| The canonical location, derived from the active view.
-}
repositoryLocation : Model -> RepositoryLocation
repositoryLocation model =
    { repository = model.repository
    , view =
        case model.view of
            Files files ->
                FilesView files

            Commits reference _ ->
                CommitsView reference

            PullRequests state _ ->
                PullsView state
    }


loadingSnapshot : Model -> Maybe SnapshotRequest
loadingSnapshot model =
    case model.local of
        LocalResolving (LoadSnapshot request) ->
            Just request

        LocalResolving DiscoverLocal ->
            Nothing

        LocalMissing _ ->
            Nothing

        LocalFailed _ _ ->
            Nothing

        LocalReady _ ->
            Nothing


missingRepository : Model -> Maybe MissingRepository
missingRepository model =
    case model.local of
        LocalMissing missing ->
            Just missing

        LocalResolving _ ->
            Nothing

        LocalFailed _ _ ->
            Nothing

        LocalReady _ ->
            Nothing


readySnapshot : Model -> Maybe RepositorySnapshot
readySnapshot model =
    case model.local of
        LocalReady snapshot ->
            Just snapshot

        LocalResolving _ ->
            Nothing

        LocalMissing _ ->
            Nothing

        LocalFailed _ _ ->
            Nothing


subscriptions : Model -> Sub Msg
subscriptions model =
    case model.local of
        LocalReady _ ->
            Time.every sourcePollMilliseconds PollSourceControl

        LocalResolving _ ->
            Sub.none

        LocalMissing _ ->
            Sub.none

        LocalFailed _ _ ->
            Sub.none



-- UPDATE


update : Msg -> Model -> ( Model, Effect Msg )
update msg model =
    let
        mapSnapshot transform =
            case model.local of
                LocalReady snapshot ->
                    ( { model | local = LocalReady (transform snapshot) }, Effect.none )

                LocalResolving _ ->
                    unchanged model

                LocalMissing _ ->
                    unchanged model

                LocalFailed _ _ ->
                    unchanged model

        mapFiles transform =
            mapSnapshot (\snapshot -> { snapshot | files = transform snapshot.files })

        push location =
            ( model, Effect.PushUrl (Route.toPath (Route.Repository { repository = model.repository, view = location })) )
    in
    case msg of
        FilesLoaded request files ->
            if Maybe.map .revision (loadingSnapshot model) == Just request.revision then
                finishSnapshot request files model

            else
                unchanged model

        FilesFailed request error ->
            if Maybe.map .revision (loadingSnapshot model) == Just request.revision then
                ( { model | local = LocalFailed (LoadSnapshot request) error }, Effect.none )

            else
                unchanged model

        FileLoaded request file ->
            mapFiles (RepositoryFiles.fileLoaded request file)

        FileFailed request error ->
            mapFiles (RepositoryFiles.fileFailed request error)

        SearchLoaded request results ->
            mapFiles (RepositoryFiles.searchLoaded request results)

        SearchFailed request error ->
            mapFiles (RepositoryFiles.searchFailed request error)

        CommitsLoaded requested commits ->
            ( settleCommits requested (Success requested commits) model, Effect.none )

        CommitsFailed requested error ->
            ( settleCommits requested (Failure requested error) model, Effect.none )

        PullsLoaded request page ->
            ( mapPulls (RepositoryPulls.loaded request page) model, Effect.none )

        PullsFailed request error ->
            ( mapPulls (RepositoryPulls.failed request error) model, Effect.none )

        SourceLoaded request status ->
            sourceLoaded request status model

        SourceFailed request error ->
            sourceFailed request error model

        PullCompleted requested count ->
            withIdleSource requested model <|
                \snapshot source ->
                    ( { model | local = LocalReady { snapshot | sourceControl = { source | activity = PullSynchronizing count } } }
                    , Api.refreshSourceControl model.repository
                        (SourceLoaded (SnapshotSource requested (PulledSnapshot count)))
                        (SourceFailed (SnapshotSource requested (PulledSnapshot count)))
                    )

        PullFailed requested error ->
            withSnapshot requested model (failSource PullOperation error)

        CloneLoaded request _ ->
            case missingRepository model of
                Just missing ->
                    if missing.clone == CloneInFlight request then
                        ( { model | local = LocalResolving DiscoverLocal }, discover model.repository )

                    else
                        unchanged model

                Nothing ->
                    unchanged model

        CloneFailed request error ->
            case missingRepository model of
                Just missing ->
                    if missing.clone == CloneInFlight request then
                        ( { model | local = LocalMissing { missing | clone = CloneFailure request error } }, Effect.none )

                    else
                        unchanged model

                Nothing ->
                    unchanged model

        ChangedSearch query ->
            mapFiles (RepositoryFiles.changeSearchDraft query)

        SelectedSearchMode mode ->
            mapFiles (RepositoryFiles.selectSearchMode mode)

        SubmittedSearch ->
            case readySnapshot model of
                Just snapshot ->
                    let
                        query =
                            String.trim (RepositoryFiles.searchDraft snapshot.files)
                    in
                    push
                        (FilesView
                            { ref = activeRef model
                            , path = Nothing
                            , search =
                                if query == "" then
                                    NoSearch

                                else
                                    Search query (RepositoryFiles.searchDraftMode snapshot.files)
                            }
                        )

                Nothing ->
                    unchanged model

        SelectedTab tab ->
            push
                (case tab of
                    FilesTab ->
                        FilesView { ref = activeRef model, path = Nothing, search = NoSearch }

                    PullsTab ->
                        PullsView OpenPulls

                    CommitsTab ->
                        CommitsView (activeRef model)
                )

        SelectedFile path ->
            push (FilesView { ref = activeRef model, path = Just path, search = activeSearch model })

        ClosedFile ->
            push (FilesView { ref = activeRef model, path = Nothing, search = activeSearch model })

        ToggledFolder path ->
            mapFiles (RepositoryFiles.toggleFolder path)

        ToggledSourceFold fold ->
            mapFiles (RepositoryFiles.toggleSourceFold fold)

        SelectedPullState state ->
            push (PullsView state)

        RequestedMorePulls ->
            case model.view of
                PullRequests state pulls ->
                    case RepositoryPulls.more pulls of
                        Just ( updated, request ) ->
                            ( { model | view = PullRequests state updated }, loadPullRequests request )

                        Nothing ->
                            unchanged model

                Files _ ->
                    unchanged model

                Commits _ _ ->
                    unchanged model

        SelectedBranch branch ->
            withReadySource model <|
                \snapshot source ->
                    ( { model | local = LocalReady { snapshot | sourceControl = { source | activity = BranchSwitching branch } } }
                    , Api.switchBranch model.repository
                        branch
                        (SourceLoaded (SnapshotSource snapshot.revision (SwitchedSnapshot branch)))
                        (SourceFailed (SnapshotSource snapshot.revision (SwitchedSnapshot branch)))
                    )

        RequestedSourceRefresh ->
            refreshSource RefreshedSnapshot model

        RequestedPull ->
            withReadySource model <|
                \snapshot source ->
                    if SourceControl.canPull source.status then
                        ( { model | local = LocalReady { snapshot | sourceControl = { source | activity = PullInFlight } } }
                        , Api.pullRepository model.repository (PullCompleted snapshot.revision) (PullFailed snapshot.revision)
                        )

                    else
                        unchanged model

        RequestedClone root ->
            let
                start missing =
                    let
                        request =
                            CloneRequest model.repository root
                    in
                    ( { model | local = LocalMissing { missing | clone = CloneInFlight request } }
                    , Api.cloneRepository model.repository root (CloneLoaded request) (CloneFailed request)
                    )
            in
            case Maybe.map (\missing -> ( missing, missing.clone )) (missingRepository model) of
                Just ( missing, CloneIdle ) ->
                    start missing

                Just ( missing, CloneFailure _ _ ) ->
                    start missing

                Just ( _, CloneInFlight _ ) ->
                    unchanged model

                Nothing ->
                    unchanged model

        SelectedCommit commit ->
            ( model
            , Effect.PushUrl (Route.toPath (Route.Review { repository = model.repository, subject = Route.Commit (Git.oidToString commit.sha) Nothing }))
            )

        PollSourceControl _ ->
            refreshSource PolledSnapshot model


{-| Accepts a source-control response for the request that is still active.
A refresh that finds the same checkout keeps the browsed files; a new OID
loads a new immutable snapshot.
-}
sourceLoaded : SourceRequest -> SourceControlStatus -> Model -> ( Model, Effect Msg )
sourceLoaded request status model =
    let
        observed =
            Revision.create model.repository (Repository.checkoutOid status.checkout)
    in
    case ( request, model.local ) of
        ( DiscoverSource repository, LocalResolving DiscoverLocal ) ->
            if repository == model.repository then
                beginSnapshot observed InitialSnapshot status model

            else
                unchanged model

        ( DiscoverSource _, _ ) ->
            unchanged model

        ( SnapshotSource requested completion, LocalReady snapshot ) ->
            if requested /= snapshot.revision then
                unchanged model

            else if observed == snapshot.revision then
                ( { model
                    | local =
                        LocalReady
                            { snapshot | sourceControl = { repository = model.repository, status = status, activity = completedActivity completion } }
                  }
                , Effect.none
                )

            else
                beginSnapshot observed completion status model

        ( SnapshotSource _ _, _ ) ->
            unchanged model


sourceFailed : SourceRequest -> ApiError -> Model -> ( Model, Effect Msg )
sourceFailed request error model =
    case ( request, model.local ) of
        ( DiscoverSource repository, LocalResolving DiscoverLocal ) ->
            if repository /= model.repository then
                unchanged model

            else if ApiError.isNotFound error then
                ( { model | local = LocalMissing { error = error, clone = CloneIdle } }, Effect.none )

            else
                ( { model | local = LocalFailed DiscoverLocal error }, Effect.none )

        ( DiscoverSource _, _ ) ->
            unchanged model

        ( SnapshotSource revision (SwitchedSnapshot branch), _ ) ->
            withSnapshot revision model (failSource (SwitchOperation branch) error)

        ( SnapshotSource revision _, _ ) ->
            withSnapshot revision model (failSource RefreshOperation error)


{-| A failed operation keeps the snapshot it was started from.
-}
failSource : Operation -> ApiError -> RepositorySnapshot -> RepositorySnapshot
failSource operation error snapshot =
    let
        source =
            snapshot.sourceControl
    in
    { snapshot | sourceControl = { source | activity = Failed operation error } }


withSnapshot : Revision -> Model -> (RepositorySnapshot -> RepositorySnapshot) -> ( Model, Effect Msg )
withSnapshot revision model transform =
    case readySnapshot model of
        Just snapshot ->
            if snapshot.revision == revision then
                ( { model | local = LocalReady (transform snapshot) }, Effect.none )

            else
                unchanged model

        Nothing ->
            unchanged model


beginSnapshot : Revision -> SnapshotCompletion -> SourceControlStatus -> Model -> ( Model, Effect Msg )
beginSnapshot revision completion status model =
    let
        request =
            { revision = revision
            , source = { repository = model.repository, status = status, activity = loadingActivity completion }
            , completion = completion
            }

        updated =
            { model
                | local = LocalResolving (LoadSnapshot request)
                , view = withRef (checkoutRef status.checkout) model.view
            }
    in
    ( updated
    , Effect.batch
        [ Api.fetchRepositoryFiles revision (FilesLoaded request) (FilesFailed request)
        , Effect.ReplaceUrl (Route.toPath (Route.Repository (repositoryLocation updated)))
        ]
    )


finishSnapshot : SnapshotRequest -> List File -> Model -> ( Model, Effect Msg )
finishSnapshot request files model =
    let
        ( path, search ) =
            case model.view of
                Files location ->
                    ( location.path, location.search )

                Commits _ _ ->
                    ( Nothing, NoSearch )

                PullRequests _ _ ->
                    ( Nothing, NoSearch )

        ( browser, requests ) =
            RepositoryFiles.init request.revision files path search

        source =
            request.source

        ready =
            { model
                | local =
                    LocalReady
                        { revision = request.revision
                        , files = browser
                        , sourceControl = { source | activity = completedActivity request.completion }
                        }
            }
    in
    case model.view of
        Files _ ->
            ( ready, fileRequests requests )

        Commits _ _ ->
            activateView (repositoryLocation ready).view ready

        PullRequests _ _ ->
            ( ready, Effect.none )


{-| The checked-out branch, or the commit for a detached HEAD, as a URL ref.
-}
checkoutRef : Checkout -> String
checkoutRef checkout =
    case Repository.checkoutBranch checkout of
        Just branch ->
            Git.branchToString branch

        Nothing ->
            Git.oidToString (Repository.checkoutOid checkout)


withRef : String -> ActiveView -> ActiveView
withRef reference activeView =
    case activeView of
        Files location ->
            Files { location | ref = Just reference }

        Commits _ state ->
            Commits (Just reference) state

        PullRequests _ _ ->
            activeView


activeRef : Model -> Maybe String
activeRef model =
    case ( readySnapshot model, model.view ) of
        ( Just snapshot, _ ) ->
            Just (checkoutRef snapshot.sourceControl.status.checkout)

        ( Nothing, Files location ) ->
            location.ref

        ( Nothing, Commits reference _ ) ->
            reference

        ( Nothing, PullRequests _ _ ) ->
            Nothing


activeSearch : Model -> Search
activeSearch model =
    case model.view of
        Files location ->
            location.search

        Commits _ _ ->
            NoSearch

        PullRequests _ _ ->
            NoSearch


settleCommits : Revision -> Remote Revision ApiError Repository.Commits -> Model -> Model
settleCommits requested result model =
    case model.view of
        Commits reference commits ->
            if commits == Loading requested then
                { model | view = Commits reference result }

            else
                model

        Files _ ->
            model

        PullRequests _ _ ->
            model


mapPulls : (RepositoryPulls.Model -> RepositoryPulls.Model) -> Model -> Model
mapPulls transform model =
    case model.view of
        PullRequests state pulls ->
            { model | view = PullRequests state (transform pulls) }

        Files _ ->
            model

        Commits _ _ ->
            model


loadingActivity : SnapshotCompletion -> Activity
loadingActivity completion =
    case completion of
        InitialSnapshot ->
            Refreshing

        RefreshedSnapshot ->
            Refreshing

        PolledSnapshot ->
            Refreshing

        SwitchedSnapshot branch ->
            BranchSwitching branch

        PulledSnapshot count ->
            PullSynchronizing count


{-| A background poll settles silently; user actions report their outcome.
-}
completedActivity : SnapshotCompletion -> Activity
completedActivity completion =
    case completion of
        InitialSnapshot ->
            Idle

        PolledSnapshot ->
            Idle

        RefreshedSnapshot ->
            Succeeded Refreshed

        SwitchedSnapshot branch ->
            Succeeded (Switched branch)

        PulledSnapshot count ->
            Succeeded (Pulled count)


withReadySource : Model -> (RepositorySnapshot -> SourceControl.Snapshot -> ( Model, Effect Msg )) -> ( Model, Effect Msg )
withReadySource model apply =
    case readySnapshot model of
        Just snapshot ->
            if SourceControl.busy snapshot.sourceControl.activity then
                unchanged model

            else
                apply snapshot snapshot.sourceControl

        Nothing ->
            unchanged model


withIdleSource : Revision -> Model -> (RepositorySnapshot -> SourceControl.Snapshot -> ( Model, Effect Msg )) -> ( Model, Effect Msg )
withIdleSource requested model apply =
    case readySnapshot model of
        Just snapshot ->
            if snapshot.revision == requested && snapshot.sourceControl.activity == PullInFlight then
                apply snapshot snapshot.sourceControl

            else
                unchanged model

        Nothing ->
            unchanged model


refreshSource : SnapshotCompletion -> Model -> ( Model, Effect Msg )
refreshSource completion model =
    withReadySource model <|
        \snapshot source ->
            let
                request =
                    SnapshotSource snapshot.revision completion
            in
            ( { model | local = LocalReady { snapshot | sourceControl = { source | activity = Refreshing } } }
            , Api.refreshSourceControl model.repository (SourceLoaded request) (SourceFailed request)
            )


unchanged : Model -> ( Model, Effect Msg )
unchanged model =
    ( model, Effect.none )



-- VIEW


toolbar : Model -> List (Html Msg)
toolbar model =
    ToolbarView.view
        { repository = repositoryName model
        , activeTab =
            case model.view of
                Files _ ->
                    FilesTab

                Commits _ _ ->
                    CommitsTab

                PullRequests _ _ ->
                    PullsTab
        , selectedTab = SelectedTab
        }


searchForm : RepositorySnapshot -> Html Msg
searchForm snapshot =
    let
        mode =
            RepositoryFiles.searchDraftMode snapshot.files
    in
    form [ class "repository-search", onSubmit SubmittedSearch ]
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


searchModeButton : String -> String -> SearchMode -> SearchMode -> Html Msg
searchModeButton short labelText mode active =
    button
        [ type_ "button"
        , title labelText
        , attribute "aria-label" labelText
        , classList [ ( "search-mode-button", True ), ( "is-active", mode == active ) ]
        , onClick (SelectedSearchMode mode)
        ]
        [ text short ]


view : Feature -> Model -> Html Msg
view syntaxHighlighting model =
    main_ [ class "repository-shell" ]
        [ case ( model.view, readySnapshot model ) of
            ( Files _, Just snapshot ) ->
                div [ class "repository-context-bar" ] [ searchForm snapshot ]

            _ ->
                text ""
        , case sourceControlState model of
            Just state ->
                SourceControlView.view
                    { state = state
                    , selectedBranch = SelectedBranch
                    , requestedRefresh = RequestedSourceRefresh
                    , requestedPull = RequestedPull
                    }

            Nothing ->
                text ""
        , case model.view of
            PullRequests state pulls ->
                PullRequestsView.view
                    { repository = model.repository
                    , activeState = state
                    , pulls = pulls
                    , selectedState = SelectedPullState
                    , requestedMore = RequestedMorePulls
                    }

            Commits reference commits ->
                CommitsView.view
                    { state =
                        case readySnapshot model of
                            Just _ ->
                                CommitsView.CommitsRemote commits

                            Nothing ->
                                CommitsView.LocalUnavailable (localUnavailable "Loading commits…" model)
                    , reference = reference
                    , selectedCommit = SelectedCommit
                    }

            Files location ->
                FilesView.view
                    { state =
                        case readySnapshot model of
                            Just snapshot ->
                                FilesView.FilesReady
                                    { syntaxHighlighting = syntaxHighlighting
                                    , selectedPath = location.path
                                    , search = location.search
                                    , files = snapshot.files
                                    , selectedFile = SelectedFile
                                    , closedFile = ClosedFile
                                    , toggledFolder = ToggledFolder
                                    , toggledSourceFold = ToggledSourceFold
                                    }

                            Nothing ->
                                FilesView.LocalUnavailable (localUnavailable "Reading repository files…" model)
                    }
        ]


sourceControlState : Model -> Maybe SourceControl.State
sourceControlState model =
    case model.local of
        LocalReady snapshot ->
            Just (SourceControl.Ready snapshot.sourceControl)

        LocalResolving (LoadSnapshot request) ->
            Just (SourceControl.Ready request.source)

        LocalFailed (LoadSnapshot _) error ->
            Just (SourceControl.Unavailable model.repository error)

        LocalResolving DiscoverLocal ->
            Nothing

        LocalFailed DiscoverLocal _ ->
            Nothing

        LocalMissing _ ->
            Nothing


localUnavailable : String -> Model -> LocalView.Unavailable Msg
localUnavailable loadingMessage model =
    case model.local of
        LocalMissing missing ->
            LocalView.Missing
                { error = missing.error
                , clone =
                    case missing.clone of
                        CloneIdle ->
                            LocalView.NotCloning

                        CloneInFlight _ ->
                            LocalView.Cloning

                        CloneFailure _ error ->
                            LocalView.CloneFailed error
                , cloneTemporary = RequestedClone Temporary
                , cloneConfigured = RequestedClone Configured
                }

        LocalFailed _ error ->
            LocalView.Failed "Could not read this repository" error

        LocalResolving _ ->
            LocalView.Resolving loadingMessage "Resolving an immutable local Git revision."

        LocalReady _ ->
            LocalView.Resolving loadingMessage "Reading immutable OIDs from the local repository."
