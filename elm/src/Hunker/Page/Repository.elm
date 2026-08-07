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
import Hunker.Domain.Repository as Repository exposing (Checkout(..), Commit, File, FileContent, PullRequest, PullRequestsPage, SearchResults, SourceControlStatus)
import Hunker.Effect as Effect exposing (Effect)
import Hunker.FileTree as FileTree exposing (Tree(..))
import Hunker.Remote exposing (Remote(..))
import Hunker.Route as Route exposing (RepositoryTab(..))
import Hunker.Syntax as Syntax
import Set exposing (Set)
import Time
import Url


type alias Model =
    { location : Route.RepositoryLocation
    , files : Remote String String (List File)
    , selectedFile : Remote ( String, String ) String FileContent
    , search : Remote ( String, String, String ) String SearchResults
    , commits : Remote String String Repository.Commits
    , pulls : Remote ( String, String, Int ) String PullRequestsPage
    , pullRows : List PullRequest
    , pullHasMore : Bool
    , sourceControl : SourceControl
    , clone : Remote ( String, String ) String String
    , collapsedFolders : Set String
    , searchDraft : String
    , searchMode : String
    }


type SourceControl
    = SourceLoading String
    | SourceUnavailable String String
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
    | FilesFailed String String
    | FileLoaded ( String, String ) FileContent
    | FileFailed ( String, String ) String
    | SearchLoaded ( String, String, String ) SearchResults
    | SearchFailed ( String, String, String ) String
    | CommitsLoaded String Repository.Commits
    | CommitsFailed String String
    | PullsLoaded ( String, String, Int ) PullRequestsPage
    | PullsFailed ( String, String, Int ) String
    | SourceLoaded String SourceControlStatus
    | PullCompleted String Int
    | PullStatusLoaded String Int SourceControlStatus
    | PullStatusFailed String String
    | SourceFailed String String
    | CloneLoaded ( String, String ) String
    | CloneFailed ( String, String ) String
    | ChangedSearch String
    | SelectedSearchMode String
    | SubmittedSearch
    | SelectedTab RepositoryTab
    | SelectedFile String
    | ClosedFile
    | ToggledFolder String
    | SelectedPullState String
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

        model =
            { location = location
            , files = Loading name
            , selectedFile =
                case location.path of
                    Just path ->
                        Loading ( name, path )

                    Nothing ->
                        NotAsked
            , search =
                if location.query == "" then
                    NotAsked

                else
                    Loading ( name, location.query, location.searchMode )
            , commits =
                if location.tab == RepositoryCommits then
                    Loading name

                else
                    NotAsked
            , pulls =
                if location.tab == RepositoryPulls then
                    Loading ( name, location.pullState, 1 )

                else
                    NotAsked
            , pullRows = []
            , pullHasMore = False
            , sourceControl = SourceLoading name
            , clone = NotAsked
            , collapsedFolders = Set.empty
            , searchDraft = location.query
            , searchMode = location.searchMode
            }

        effects =
            [ Api.fetchRepositoryFiles name (FilesLoaded name) (FilesFailed name)
            , Api.refreshSourceControl name (SourceLoaded name) (SourceFailed name)
            , case location.path of
                Just path ->
                    Api.fetchRepositoryFile name path (FileLoaded ( name, path )) (FileFailed ( name, path ))

                Nothing ->
                    Effect.none
            , if location.query == "" then
                Effect.none

              else
                Api.searchRepository name
                    location.query
                    location.searchMode
                    (SearchLoaded ( name, location.query, location.searchMode ))
                    (SearchFailed ( name, location.query, location.searchMode ))
            , if location.tab == RepositoryCommits then
                Api.fetchRepositoryCommits name (CommitsLoaded name) (CommitsFailed name)

              else
                Effect.none
            , if location.tab == RepositoryPulls then
                Api.fetchRepositoryPulls name
                    location.pullState
                    1
                    (PullsLoaded ( name, location.pullState, 1 ))
                    (PullsFailed ( name, location.pullState, 1 ))

              else
                Effect.none
            ]
    in
    ( model, Effect.batch effects )


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
    let
        name =
            repositoryName model

        fileChanged =
            nextLocation.path /= model.location.path

        searchChanged =
            nextLocation.query
                /= model.location.query
                || nextLocation.searchMode
                /= model.location.searchMode

        pullsChanged =
            nextLocation.pullState /= model.location.pullState

        loadCommits =
            nextLocation.tab
                == RepositoryCommits
                && (case model.commits of
                        NotAsked ->
                            True

                        _ ->
                            False
                   )

        loadPulls =
            nextLocation.tab
                == RepositoryPulls
                && (pullsChanged
                        || (case model.pulls of
                                NotAsked ->
                                    True

                                _ ->
                                    False
                           )
                   )

        selectedFile =
            if not fileChanged then
                model.selectedFile

            else
                case nextLocation.path of
                    Just path ->
                        Loading ( name, path )

                    Nothing ->
                        NotAsked

        search =
            if not searchChanged then
                model.search

            else if nextLocation.query == "" then
                NotAsked

            else
                Loading ( name, nextLocation.query, nextLocation.searchMode )

        commits =
            if loadCommits then
                Loading name

            else
                model.commits

        pullRequest =
            ( name, nextLocation.pullState, 1 )

        pulls =
            if loadPulls then
                Loading pullRequest

            else
                model.pulls

        updated =
            { model
                | location = nextLocation
                , selectedFile = selectedFile
                , search = search
                , commits = commits
                , pulls = pulls
                , pullRows =
                    if pullsChanged then
                        []

                    else
                        model.pullRows
                , pullHasMore =
                    if pullsChanged then
                        False

                    else
                        model.pullHasMore
                , collapsedFolders = revealLocationPath nextLocation.path model
                , searchDraft = nextLocation.query
                , searchMode = nextLocation.searchMode
            }

        effects =
            [ case nextLocation.path of
                Just path ->
                    if fileChanged then
                        Api.fetchRepositoryFile name path (FileLoaded ( name, path )) (FileFailed ( name, path ))

                    else
                        Effect.none

                Nothing ->
                    Effect.none
            , if searchChanged && nextLocation.query /= "" then
                Api.searchRepository name
                    nextLocation.query
                    nextLocation.searchMode
                    (SearchLoaded ( name, nextLocation.query, nextLocation.searchMode ))
                    (SearchFailed ( name, nextLocation.query, nextLocation.searchMode ))

              else
                Effect.none
            , if loadCommits then
                Api.fetchRepositoryCommits name (CommitsLoaded name) (CommitsFailed name)

              else
                Effect.none
            , if loadPulls then
                Api.fetchRepositoryPulls name
                    nextLocation.pullState
                    1
                    (PullsLoaded pullRequest)
                    (PullsFailed pullRequest)

              else
                Effect.none
            ]
    in
    ( updated, Effect.batch effects )


revealLocationPath : Maybe String -> Model -> Set String
revealLocationPath maybePath model =
    case ( maybePath, model.files ) of
        ( Just path, Success _ files ) ->
            model.collapsedFolders
                |> Set.toList
                |> FileTree.reveal path
                |> Set.fromList

        _ ->
            model.collapsedFolders


repositoryName : Model -> String
repositoryName model =
    model.location.owner ++ "/" ++ model.location.repository


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
                    | files = Success requested files
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
                ( { model | files = Failure requested error }, Effect.none )

            else
                unchanged model

        FileLoaded request file ->
            if request == ( repositoryName model, Maybe.withDefault "" model.location.path ) then
                ( { model | selectedFile = Success request file }, Effect.none )

            else
                unchanged model

        FileFailed request error ->
            if request == ( repositoryName model, Maybe.withDefault "" model.location.path ) then
                ( { model | selectedFile = Failure request error }, Effect.none )

            else
                unchanged model

        SearchLoaded request results ->
            if request == ( repositoryName model, model.location.query, model.location.searchMode ) then
                ( { model | search = Success request results }, Effect.none )

            else
                unchanged model

        SearchFailed request error ->
            if request == ( repositoryName model, model.location.query, model.location.searchMode ) then
                ( { model | search = Failure request error }, Effect.none )

            else
                unchanged model

        CommitsLoaded requested commits ->
            if requested == repositoryName model then
                ( { model | commits = Success requested commits }, Effect.none )

            else
                unchanged model

        CommitsFailed requested error ->
            if requested == repositoryName model then
                ( { model | commits = Failure requested error }, Effect.none )

            else
                unchanged model

        PullsLoaded request page ->
            if request /= ( repositoryName model, model.location.pullState, page.page ) then
                unchanged model

            else
                let
                    rows =
                        if page.page == 1 then
                            page.pullRequests

                        else
                            model.pullRows ++ page.pullRequests
                in
                ( { model
                    | pulls = Success request page
                    , pullRows = rows
                    , pullHasMore = page.hasMore
                  }
                , Effect.none
                )

        PullsFailed request error ->
            if tripleFirst request == repositoryName model then
                ( { model | pulls = Failure request error }, Effect.none )

            else
                unchanged model

        SourceLoaded requested status ->
            if requested == repositoryName model then
                ( { model
                    | sourceControl =
                        SourceReady
                            { repository = requested
                            , status = status
                            , activity = SourceIdle
                            }
                  }
                , Effect.none
                )

            else
                unchanged model

        PullCompleted requested count ->
            updateReadySource requested model <|
                \source ->
                    ( { model
                        | sourceControl =
                            SourceReady { source | activity = PullSynchronizing count }
                      }
                    , Api.refreshSourceControl requested
                        (PullStatusLoaded requested count)
                        (PullStatusFailed requested)
                    )

        PullStatusLoaded requested count status ->
            if requested == repositoryName model then
                ( { model
                    | sourceControl =
                        SourceReady
                            { repository = requested
                            , status = status
                            , activity = SourceSucceeded (pulledMessage count)
                            }
                  }
                , Effect.none
                )

            else
                unchanged model

        PullStatusFailed requested error ->
            if requested == repositoryName model then
                ( { model
                    | sourceControl =
                        SourceUnavailable requested
                            ("The pull completed, but Git status could not be refreshed. " ++ error)
                  }
                , Effect.none
                )

            else
                unchanged model

        SourceFailed requested error ->
            if requested == repositoryName model then
                ( { model | sourceControl = SourceUnavailable requested error }, Effect.none )

            else
                unchanged model

        CloneLoaded request path ->
            if Tuple.first request /= repositoryName model then
                unchanged model

            else
                let
                    name =
                        repositoryName model
                in
                ( { model
                    | clone = Success request path
                    , files = Loading name
                    , sourceControl = SourceLoading name
                  }
                , Effect.batch
                    [ Api.fetchRepositoryFiles name (FilesLoaded name) (FilesFailed name)
                    , Api.refreshSourceControl name (SourceLoaded name) (SourceFailed name)
                    ]
                )

        CloneFailed request error ->
            if Tuple.first request == repositoryName model then
                ( { model | clone = Failure request error }, Effect.none )

            else
                unchanged model

        ChangedSearch query ->
            ( { model | searchDraft = query }, Effect.none )

        SelectedSearchMode mode ->
            ( { model | searchMode = mode }, Effect.none )

        SubmittedSearch ->
            ( model, Effect.PushUrl (repositoryPath model RepositoryFiles Nothing model.searchDraft model.searchMode model.location.pullState) )

        SelectedTab tab ->
            ( model, Effect.PushUrl (repositoryPath model tab Nothing "" "literal" model.location.pullState) )

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
            ( model, Effect.PushUrl (repositoryPath model RepositoryPulls Nothing "" "literal" state) )

        RequestedMorePulls ->
            let
                page =
                    case model.pulls of
                        Success ( _, _, current ) _ ->
                            current + 1

                        Failure ( _, _, current ) _ ->
                            current + 1

                        _ ->
                            1

                request =
                    ( repositoryName model, model.location.pullState, page )
            in
            ( { model | pulls = Loading request }
            , Api.fetchRepositoryPulls (repositoryName model)
                model.location.pullState
                page
                (PullsLoaded request)
                (PullsFailed request)
            )

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
                        ( { model | sourceControl = SourceReady { source | activity = BranchSwitching branch } }
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
                        ( { model | sourceControl = SourceReady { source | activity = PullInFlight } }
                        , Api.pullRepository name (PullCompleted name) (SourceFailed name)
                        )

        RequestedClone destination ->
            let
                request =
                    ( repositoryName model, destination )
            in
            ( { model | clone = Loading request }
            , Api.cloneRepository (repositoryName model) destination (CloneLoaded request) (CloneFailed request)
            )

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
    case model.sourceControl of
        SourceReady source ->
            if sourceBusy source.activity then
                unchanged model

            else
                ( { model | sourceControl = SourceReady { source | activity = SourceRefreshing } }
                , Api.refreshSourceControl name (SourceLoaded name) (SourceFailed name)
                )

        SourceUnavailable requested _ ->
            ( { model | sourceControl = SourceLoading requested }
            , Api.refreshSourceControl name (SourceLoaded name) (SourceFailed name)
            )

        SourceLoading _ ->
            unchanged model


updateReadySource : String -> Model -> (SourceSnapshot -> ( Model, Effect Msg )) -> ( Model, Effect Msg )
updateReadySource requested model updateSource =
    case model.sourceControl of
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


repositoryPath : Model -> RepositoryTab -> Maybe String -> String -> String -> String -> String
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
            [ searchModeButton "T" "Text" "literal" model.searchMode
            , searchModeButton ".*" "Regex" "regex" model.searchMode
            , searchModeButton "F" "Fuzzy · FFF" "fuzzy" model.searchMode
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


searchModeButton : String -> String -> String -> String -> Html Msg
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
    case model.sourceControl of
        SourceLoading _ ->
            section [ class "repository-source-control", attribute "role" "status" ]
                [ span [ class "source-control-loading" ] [ text "Reading Git state…" ] ]

        SourceUnavailable _ error ->
            section [ class "repository-source-control" ]
                [ span [ class "source-control-feedback is-error", attribute "role" "alert" ] [ text error ]
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
    case model.files of
        Failure _ error ->
            cloneOffer model error

        Loading _ ->
            pageState "Reading repository files…" "Using the current local checkout without switching other tabs."

        NotAsked ->
            text ""

        Success _ files ->
            div [ class "repository-workspace" ]
                [ aside [ class "repository-file-sidebar" ]
                    [ header [] [ strong [] [ text "Files" ], span [ class "count-badge" ] [ text (String.fromInt (List.length files)) ] ]
                    , fileTree model (FileTree.build .path files)
                    ]
                , section [ class "repository-results" ]
                    [ case model.location.path of
                        Just _ ->
                            repositoryFileView syntaxHighlighting model

                        Nothing ->
                            if model.location.query /= "" then
                                repositorySearchView model

                            else
                                div [ class "repository-empty-selection" ]
                                    [ h1 [] [ text "Choose a file" ]
                                    , p [] [ text "Browse the collapsed tree or search literal text, regular expressions, or FFF fuzzy matches." ]
                                    ]
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


repositoryFileView : Bool -> Model -> Html Msg
repositoryFileView syntaxHighlighting model =
    case model.selectedFile of
        Loading _ ->
            pageState ("Opening " ++ Maybe.withDefault "file" model.location.path ++ "…") ""

        Failure _ error ->
            section [ class "page-state is-error" ] [ h1 [] [ text "Could not open file" ], p [] [ text error ] ]

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


repositorySearchView : Model -> Html Msg
repositorySearchView model =
    case model.search of
        Loading _ ->
            pageState ("Searching for “" ++ model.location.query ++ "”…") (searchDescription model.location.searchMode)

        Failure _ error ->
            section [ class "page-state is-error" ] [ h1 [] [ text "Search failed" ], p [] [ text error ] ]

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
    case model.commits of
        Loading _ ->
            pageState "Loading commits…" "Reading immutable OIDs from the local checkout."

        Failure _ error ->
            section [ class "page-state is-error" ] [ h1 [] [ text "Could not load commits" ], p [] [ text error ] ]

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


commitRow : Commit -> Html Msg
commitRow commit =
    button [ type_ "button", class "commit-row repository-commit-row", onClick (SelectedCommit commit) ]
        [ span [ class "commit-avatar" ] [ text (String.left 2 (String.toUpper commit.authorName)) ]
        , span [ class "commit-copy" ]
            [ strong [] [ text commit.subject ]
            , span [] [ text (commit.authorName ++ " · " ++ commit.authoredAt) ]
            ]
        , code [ class "commit-sha" ] [ text (String.left 7 commit.sha) ]
        , span [ class "commit-open-arrow" ] [ text "→" ]
        ]


pullsView : Model -> Html Msg
pullsView model =
    section [ class "repository-pulls-browser" ]
        [ header [ class "repository-pulls-heading" ]
            [ div []
                [ span [] [ text "GitHub" ]
                , h1 [] [ text ("Pull requests for " ++ repositoryName model) ]
                , p [] [ text "Open a pull request directly in Hunker’s diff view." ]
                ]
            , div [ class "segmented repository-pull-filters" ]
                (List.map (pullFilter model.location.pullState) [ "open", "closed", "all" ])
            ]
        , case model.pulls of
            Loading _ ->
                if List.isEmpty model.pullRows then
                    pageState "Loading pull requests…" "Reading pull requests through your GitHub login."

                else
                    pullRowsView model True

            Failure _ error ->
                if List.isEmpty model.pullRows then
                    section [ class "page-state is-error" ] [ h1 [] [ text "Could not load pull requests" ], p [] [ text error ] ]

                else
                    div [] [ pullRowsView model False, p [ class "repository-pull-page-error" ] [ text error ] ]

            Success _ _ ->
                pullRowsView model False

            NotAsked ->
                text ""
        ]


pullFilter : String -> String -> Html Msg
pullFilter active state =
    button [ type_ "button", class ("segmented-button" ++ activeClass (active == state)), onClick (SelectedPullState state) ]
        [ text
            (if state == "all" then
                "All"

             else if state == "closed" then
                "Closed"

             else
                "Open"
            )
        ]


pullRowsView : Model -> Bool -> Html Msg
pullRowsView model loading =
    div [ class "repository-pull-list" ]
        (List.map (pullRow model) model.pullRows
            ++ (if model.pullHasMore then
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


cloneOffer : Model -> String -> Html Msg
cloneOffer model error =
    section [ class "repository-clone-offer" ]
        [ span [ class "repository-clone-mark" ] [ text "git" ]
        , h1 [] [ text "Clone this repository for local browsing" ]
        , p [] [ text error ]
        , cloneFeedback model.clone
        , div [ class "repository-clone-actions" ]
            [ button [ type_ "button", disabled (isCloneLoading model.clone), onClick (RequestedClone "temporary") ] [ text "Clone to /tmp" ]
            , button [ type_ "button", disabled (isCloneLoading model.clone), onClick (RequestedClone "configured") ] [ text "Clone to repos root" ]
            ]
        , small [] [ text "Clones start shallow and use your local GitHub authentication for private repositories." ]
        ]


cloneFeedback : Remote ( String, String ) String String -> Html Msg
cloneFeedback remote =
    case remote of
        Loading _ ->
            p [ class "repository-clone-feedback" ] [ text "Cloning…" ]

        Failure _ error ->
            p [ class "repository-clone-error" ] [ text error ]

        Success _ path ->
            p [ class "repository-clone-feedback" ] [ text ("Cloned to " ++ path) ]

        NotAsked ->
            text ""


isCloneLoading : Remote identity error value -> Bool
isCloneLoading remote =
    case remote of
        Loading _ ->
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


searchDescription : String -> String
searchDescription mode =
    if mode == "fuzzy" then
        "Ranking filenames with FFF and scanning nearby content."

    else if mode == "regex" then
        "Matching a regular expression with ripgrep."

    else
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


tripleFirst : ( a, b, c ) -> a
tripleFirst ( first, _, _ ) =
    first
