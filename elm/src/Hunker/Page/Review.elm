module Hunker.Page.Review exposing
    ( Model
    , Msg(..)
    , init
    , location
    , navigate
    , settingsIntent
    , subscriptions
    , title
    , update
    , view
    )

import Html exposing (Html, a, aside, button, code, div, h1, header, main_, p, section, span, strong, text)
import Html.Attributes exposing (attribute, class, href, type_)
import Html.Events exposing (onClick)
import Html.Keyed as Keyed
import Html.Lazy as Lazy
import Hunker.Api as Api
import Hunker.ApiError as ApiError exposing (ApiError)
import Hunker.Domain.Review as Review exposing (AnalysisSnapshot, CommentSide, FileChange, FileStatus(..), FullFile, PullCommit, ReviewComment, ReviewDocument, Revision(..))
import Hunker.Domain.Settings as Settings exposing (InlineDiffMode(..), ReviewScope(..), Settings, ViewMode(..))
import Hunker.Effect as Effect exposing (Effect)
import Hunker.FileTree as FileTree
import Hunker.PreparedDiff exposing (PreparedFile)
import Hunker.Remote as Remote exposing (Remote(..))
import Hunker.Review.Analysis as Analysis
import Hunker.Review.Collaboration as Collaboration
import Hunker.Review.DiffView as DiffView exposing (SearchMode(..))
import Hunker.Review.FileIndex as FileIndex
import Hunker.Review.Session as Session
import Hunker.Review.View.Collaboration as CollaborationView
import Hunker.Review.View.DiffPanel as DiffPanelView
import Hunker.Review.View.FileTree as FileTreeView
import Hunker.Review.View.Toolbar as ToolbarView
import Hunker.Route as Route exposing (ReviewTab(..), ReviewTarget(..))
import Regex
import Set exposing (Set)
import Time


type alias Model =
    { review : ReviewState }


type ReviewState
    = ReviewLoading ReviewRequest
    | ReviewFailure ReviewRequest ApiError
    | ReviewReady ReadyReview


type alias ReviewRequest =
    { location : Route.ReviewLocation
    , requestUrl : String
    , pullUrl : String
    }


type alias ReadyReview =
    { request : ReviewRequest
    , session : Session.Id
    , document : ReviewDocument
    , analysis : Analysis.State
    , collaboration : Collaboration.Model
    , diff : DiffView.Model
    }


type Msg
    = ReviewLoaded String ReviewDocument
    | ReviewFailed String ApiError
    | Refreshed
    | CommitsLoaded Session.Id (List PullCommit)
    | CommitsFailed Session.Id ApiError
    | SelectedTab ReviewTab
    | SelectedCommit String
    | SelectedFile String
    | ChangedFilter String
    | SelectedSearchMode SearchMode
    | ToggledFolder String
    | ToggledSidebar
    | SelectedScope ReviewScope
    | SelectedViewMode ViewMode
    | ToggledWhitespace Bool
    | ToggledSemantic Bool
    | SelectedInlineMode InlineDiffMode
    | ToggledSyntax Bool
    | ToggledReviews Bool
    | AnalysisLoaded Analysis.Identity AnalysisSnapshot
    | AnalysisFailed Analysis.Identity ApiError
    | FullFileLoaded DiffView.FullFileRequest FullFile
    | FullFileFailed DiffView.FullFileRequest ApiError
    | ToggledFullFile FileChange
    | ToggledFile String
    | ToggledHunk String String
    | ToggledSourceFold String String
    | ToggledReviewed String
    | SelectedMoveTarget String String
    | CommentsLoaded Session.Id (List ReviewComment)
    | CommentsFailed Session.Id ApiError
    | ToggledThread Int
    | ChangedReply Int String
    | SubmittedReply Int
    | ReplyLoaded Collaboration.ReplyRequest ReviewComment
    | ReplyFailed Collaboration.ReplyRequest ApiError
    | ChangedReviewBody String
    | SubmittedReview String
    | ReviewSubmitted Collaboration.ReviewRequest String
    | ReviewSubmitFailed Collaboration.ReviewRequest ApiError
    | OpenedInlineComposer String Int CommentSide
    | ChangedInlineBody String
    | CancelledInlineComposer
    | SubmittedInlineComment
    | InlineCommentLoaded Collaboration.InlineRequest ReviewComment
    | InlineCommentFailed Collaboration.InlineRequest ApiError
    | CheckedRevision
    | RevisionLoaded Session.Id Revision
    | RevisionFailed Session.Id ApiError
    | PollRevision Time.Posix
    | ScrolledToLocation


init : Route.ReviewLocation -> ( Model, Effect Msg )
init reviewLocation =
    let
        pullUrl =
            Route.githubUrl reviewLocation.target

        githubUrl =
            case ( reviewLocation.target, reviewLocation.commit ) of
                ( PullRequest owner repository _, Just sha ) ->
                    "https://github.com/" ++ owner ++ "/" ++ repository ++ "/commit/" ++ sha

                _ ->
                    pullUrl

        request =
            { location = reviewLocation
            , requestUrl = githubUrl
            , pullUrl = pullUrl
            }

        model =
            { review = ReviewLoading request }
    in
    ( model, Api.fetchReview githubUrl (ReviewLoaded githubUrl) (ReviewFailed githubUrl) )


location : Model -> Route.ReviewLocation
location model =
    (reviewRequest model).location


navigate : Route.ReviewLocation -> Model -> ( Model, Effect Msg )
navigate nextLocation model =
    let
        currentRequest =
            reviewRequest model

        sameRevision =
            nextLocation.target
                == currentRequest.location.target
                && nextLocation.commit
                == currentRequest.location.commit
    in
    if not sameRevision then
        init nextLocation

    else if nextLocation.path == currentRequest.location.path then
        ( model, Effect.none )

    else
        ( mapReviewRequest (\request -> { request | location = nextLocation }) model
        , nextLocation.path
            |> Maybe.map (DiffPanelView.fileAnchor >> (\anchor -> Effect.ScrollIntoView anchor ScrolledToLocation))
            |> Maybe.withDefault Effect.none
        )


title : Model -> String
title model =
    case model.review of
        ReviewLoading _ ->
            "Loading review · Hunker"

        ReviewReady ready ->
            ready.document.title ++ " · Hunker"

        ReviewFailure _ _ ->
            "Could not load review · Hunker"


subscriptions : Model -> Sub Msg
subscriptions model =
    case (reviewRequest model).location.target of
        PullRequest _ _ _ ->
            Time.every 120000 PollRevision

        _ ->
            Sub.none


reviewRequest : Model -> ReviewRequest
reviewRequest model =
    case model.review of
        ReviewLoading request ->
            request

        ReviewFailure request _ ->
            request

        ReviewReady ready ->
            ready.request


mapReviewRequest : (ReviewRequest -> ReviewRequest) -> Model -> Model
mapReviewRequest transform model =
    case model.review of
        ReviewLoading request ->
            { model | review = ReviewLoading (transform request) }

        ReviewFailure request error ->
            { model | review = ReviewFailure (transform request) error }

        ReviewReady ready ->
            { model | review = ReviewReady { ready | request = transform ready.request } }


mapReady : (ReadyReview -> ReadyReview) -> Model -> Model
mapReady transform model =
    case model.review of
        ReviewReady ready ->
            { model | review = ReviewReady (transform ready) }

        _ ->
            model


readyState : Model -> Maybe ReadyReview
readyState model =
    case model.review of
        ReviewReady ready ->
            Just ready

        _ ->
            Nothing


reviewFiles : Model -> List FileChange
reviewFiles model =
    readyState model
        |> Maybe.map (.analysis >> Analysis.files >> FileIndex.changes)
        |> Maybe.withDefault []


reviewCollaboration : Model -> Maybe Collaboration.Model
reviewCollaboration model =
    readyState model |> Maybe.map .collaboration


reviewCommits : Model -> Remote Session.Id ApiError (List PullCommit)
reviewCommits model =
    reviewCollaboration model
        |> Maybe.map Collaboration.commits
        |> Maybe.withDefault NotAsked


mapCollaboration : (Collaboration.Model -> Collaboration.Model) -> Model -> Model
mapCollaboration transform =
    mapReady (\ready -> { ready | collaboration = transform ready.collaboration })


mapDiff : (DiffView.Model -> DiffView.Model) -> Model -> Model
mapDiff transform =
    mapReady (\ready -> { ready | diff = transform ready.diff })


reviewDiff : Model -> Maybe DiffView.Model
reviewDiff model =
    readyState model |> Maybe.map .diff


update : Settings -> Msg -> Model -> ( Model, Effect Msg )
update settings msg model =
    case msg of
        ReviewLoaded requested reviewData ->
            if requested /= (reviewRequest model).requestUrl then
                unchanged model

            else
                reviewReady settings reviewData model

        ReviewFailed requested error ->
            let
                request =
                    reviewRequest model
            in
            if requested == request.requestUrl then
                ( { model | review = ReviewFailure request error }, Effect.none )

            else
                unchanged model

        Refreshed ->
            let
                request =
                    reviewRequest model
            in
            ( { model | review = ReviewLoading request }
            , Api.fetchReview request.requestUrl (ReviewLoaded request.requestUrl) (ReviewFailed request.requestUrl)
            )

        CommitsLoaded requested commits ->
            ( mapCollaboration (Collaboration.commitsLoaded requested commits) model, Effect.none )

        CommitsFailed requested error ->
            ( mapCollaboration (Collaboration.commitsFailed requested error) model, Effect.none )

        SelectedTab tab ->
            let
                current =
                    (reviewRequest model).location

                next =
                    { current | tab = tab, commit = Nothing, path = Nothing }
            in
            ( model, Effect.PushUrl (Route.toPath (Route.Review next)) )

        SelectedCommit sha ->
            let
                current =
                    (reviewRequest model).location

                next =
                    { current | tab = ReviewCommits, commit = Just sha, path = Nothing }
            in
            ( model, Effect.PushUrl (Route.toPath (Route.Review next)) )

        SelectedFile path ->
            let
                current =
                    (reviewRequest model).location

                next =
                    { current | tab = ReviewFiles, path = Just path, commit = Nothing }
            in
            ( model, Effect.PushUrl (Route.toPath (Route.Review next)) )

        ChangedFilter filter ->
            ( mapDiff (DiffView.changeFilter filter) model, Effect.none )

        SelectedSearchMode mode ->
            ( mapDiff (DiffView.selectSearchMode mode) model, Effect.none )

        ToggledFolder path ->
            ( mapDiff (DiffView.toggleFolder path) model, Effect.none )

        ToggledSidebar ->
            unchanged model

        SelectedScope scope ->
            unchanged model

        SelectedViewMode mode ->
            unchanged model

        ToggledWhitespace value ->
            beginAnalysis settings model

        ToggledSemantic value ->
            beginAnalysis settings model

        SelectedInlineMode mode ->
            beginAnalysis settings model

        ToggledSyntax value ->
            beginAnalysis settings model

        ToggledReviews value ->
            if value then
                let
                    updated =
                        beginCommentsIfNeeded { settings | showGitHubReviews = True } model
                in
                ( updated, commentsEffect { settings | showGitHubReviews = True } updated )

            else
                unchanged model

        AnalysisLoaded requested snapshot ->
            ( mapReady (\ready -> { ready | analysis = Analysis.complete requested snapshot ready.analysis }) model
            , Effect.none
            )

        AnalysisFailed requested error ->
            ( mapReady (\ready -> { ready | analysis = Analysis.fail requested error ready.analysis }) model, Effect.none )

        FullFileLoaded requested fullFile ->
            ( mapDiff (DiffView.fileLoaded requested fullFile) model, Effect.none )

        FullFileFailed requested error ->
            ( mapDiff (DiffView.fileFailed requested error) model, Effect.none )

        ToggledFullFile file ->
            case readyState model of
                Nothing ->
                    unchanged model

                Just ready ->
                    let
                        ( diff, request ) =
                            DiffView.toggleFullFile file.path ready.diff

                        effect =
                            request
                                |> Maybe.map
                                    (\current ->
                                        Api.fetchFullFile
                                            (DiffView.requestUrl current)
                                            file
                                            ready.document.backing
                                            (FullFileLoaded current)
                                            (FullFileFailed current)
                                    )
                                |> Maybe.withDefault Effect.none
                    in
                    ( mapReady (\current -> { current | diff = diff }) model, effect )

        ToggledFile path ->
            ( mapDiff (DiffView.toggleFile path) model, Effect.none )

        ToggledHunk path hunkId ->
            ( mapDiff (DiffView.toggleHunk path hunkId) model, Effect.none )

        ToggledSourceFold path fold ->
            ( mapDiff (DiffView.toggleSourceFold path fold) model, Effect.none )

        ToggledReviewed path ->
            ( mapDiff (DiffView.toggleReviewed path) model, Effect.none )

        SelectedMoveTarget path anchor ->
            let
                current =
                    (reviewRequest model).location

                next =
                    { current | path = Just path, tab = ReviewFiles }

                navigation =
                    if current.path == Just path then
                        Effect.none

                    else
                        Effect.ReplaceUrl (Route.toPath (Route.Review next))
            in
            ( model
                |> mapReviewRequest (\request -> { request | location = next })
                |> mapDiff (DiffView.revealFile path)
            , Effect.batch [ navigation, Effect.ScrollIntoView anchor ScrolledToLocation ]
            )

        ScrolledToLocation ->
            unchanged model

        CommentsLoaded requested comments ->
            ( mapCollaboration (Collaboration.commentsLoaded requested comments) model, Effect.none )

        CommentsFailed requested error ->
            ( mapCollaboration (Collaboration.commentsFailed requested error) model, Effect.none )

        ToggledThread threadId ->
            ( mapCollaboration (Collaboration.toggleThread threadId) model, Effect.none )

        ChangedReply commentId body ->
            ( mapCollaboration (Collaboration.changeReply commentId body) model, Effect.none )

        SubmittedReply commentId ->
            case reviewCollaboration model of
                Nothing ->
                    unchanged model

                Just collaboration ->
                    let
                        ( updated, submission ) =
                            Collaboration.beginReply commentId collaboration

                        effect =
                            submission
                                |> Maybe.map
                                    (\current ->
                                        Api.postReply current.pullUrl current.commentId current.body (ReplyLoaded current.request) (ReplyFailed current.request)
                                    )
                                |> Maybe.withDefault Effect.none
                    in
                    ( mapCollaboration (always updated) model, effect )

        ReplyLoaded request comment ->
            ( mapCollaboration (Collaboration.replyLoaded request comment) model, Effect.none )

        ReplyFailed request error ->
            ( mapCollaboration (Collaboration.replyFailed request error) model, Effect.none )

        ChangedReviewBody body ->
            ( mapCollaboration (Collaboration.changeReviewBody body) model, Effect.none )

        SubmittedReview event ->
            case reviewCollaboration model of
                Nothing ->
                    unchanged model

                Just collaboration ->
                    let
                        ( updated, submission ) =
                            Collaboration.beginReview event collaboration
                    in
                    ( mapCollaboration (always updated) model
                    , Api.submitReview submission.pullUrl submission.body submission.event (ReviewSubmitted submission.request) (ReviewSubmitFailed submission.request)
                    )

        ReviewSubmitted request response ->
            ( mapCollaboration (Collaboration.reviewLoaded request response) model, Effect.none )

        ReviewSubmitFailed request error ->
            ( mapCollaboration (Collaboration.reviewFailed request error) model, Effect.none )

        OpenedInlineComposer path line side ->
            ( mapCollaboration (Collaboration.openInline path line side) model, Effect.none )

        ChangedInlineBody body ->
            ( mapCollaboration (Collaboration.changeInlineBody body) model, Effect.none )

        CancelledInlineComposer ->
            ( mapCollaboration Collaboration.cancelInline model, Effect.none )

        SubmittedInlineComment ->
            case reviewCollaboration model of
                Nothing ->
                    unchanged model

                Just collaboration ->
                    let
                        ( updated, submission ) =
                            Collaboration.submitInline collaboration

                        effect =
                            submission
                                |> Maybe.map
                                    (\current ->
                                        Api.postInlineComment
                                            { pullUrl = current.pullUrl
                                            , commitId = current.commitId
                                            , path = current.path
                                            , line = current.line
                                            , side = current.side
                                            , body = current.body
                                            }
                                            (InlineCommentLoaded current.request)
                                            (InlineCommentFailed current.request)
                                    )
                                |> Maybe.withDefault Effect.none
                    in
                    ( mapCollaboration (always updated) model, effect )

        InlineCommentLoaded request comment ->
            ( mapCollaboration (Collaboration.inlineLoaded request comment) model, Effect.none )

        InlineCommentFailed request error ->
            ( mapCollaboration (Collaboration.inlineFailed request error) model, Effect.none )

        CheckedRevision ->
            revisionCheck model

        RevisionLoaded requested revision ->
            ( mapCollaboration (Collaboration.revisionLoaded requested revision) model, Effect.none )

        RevisionFailed requested error ->
            ( mapCollaboration (Collaboration.revisionFailed requested error) model, Effect.none )

        PollRevision _ ->
            revisionCheck model


reviewReady : Settings -> ReviewDocument -> Model -> ( Model, Effect Msg )
reviewReady settings reviewData model =
    let
        request =
            reviewRequest model

        currentLocation =
            request.location

        files =
            reviewData.files

        selected =
            case request.location.path |> Maybe.andThen (\path -> List.filter (.path >> (==) path) files |> List.head) of
                Just file ->
                    Just file

                Nothing ->
                    List.head files

        selectedPath =
            Maybe.map .path selected

        updatedLocation =
            { currentLocation | path = selectedPath }

        sessionId =
            Session.create request.requestUrl request.pullUrl (Review.backingHeadOid reviewData.backing)

        updated =
            { model
                | review =
                    ReviewReady
                        { request = { request | location = updatedLocation }
                        , session = sessionId
                        , document = reviewData
                        , analysis = Analysis.init (FileIndex.fromChanges files)
                        , collaboration = Collaboration.init sessionId (Route.isPullRequest request.location.target) (List.map .path files)
                        , diff = DiffView.init sessionId (List.map .path files)
                        }
            }

        canonical =
            if request.location.path == selectedPath || request.location.tab == ReviewCommits then
                Effect.none

            else
                Effect.ReplaceUrl (Route.toPath (Route.Review updatedLocation))

        commitsEffect =
            if Route.isPullRequest request.location.target then
                Api.fetchCommits request.pullUrl (CommitsLoaded sessionId) (CommitsFailed sessionId)

            else
                Effect.none
    in
    let
        ( analyzing, analysisEffect ) =
            beginAnalysis settings updated

        loadingCollaborativeData =
            analyzing
                |> beginCommentsIfNeeded settings
                |> beginRevisionIfNeeded
    in
    ( loadingCollaborativeData
    , Effect.batch
        [ canonical
        , commitsEffect
        , analysisEffect
        , commentsEffect settings loadingCollaborativeData
        , revisionEffect loadingCollaborativeData
        ]
    )


beginAnalysis : Settings -> Model -> ( Model, Effect Msg )
beginAnalysis settings model =
    case readyState model of
        Nothing ->
            ( model, Effect.none )

        Just ready ->
            if not settings.semantic && not settings.syntaxHighlighting && settings.inlineDiffMode == InlineOff then
                ( mapReady (\current -> { current | analysis = Analysis.disable current.analysis }) model
                , Effect.none
                )

            else
                let
                    identity =
                        Analysis.identity
                            ready.request.requestUrl
                            (Review.backingBaseOid ready.document.backing)
                            (Review.backingHeadOid ready.document.backing)
                            settings.ignoreWhitespace
                            settings.semantic
                            settings.syntaxHighlighting
                            settings.inlineDiffMode
                in
                ( mapReady (\current -> { current | analysis = Analysis.inFlight identity current.analysis }) model
                , Api.fetchAnalysis ready.request.requestUrl
                    ready.document.backing
                    settings.ignoreWhitespace
                    settings.semantic
                    settings.syntaxHighlighting
                    (Analysis.inlineDiff identity)
                    (AnalysisLoaded identity)
                    (AnalysisFailed identity)
                )


commentsEffect : Settings -> Model -> Effect Msg
commentsEffect settings model =
    case readyState model of
        Just ready ->
            if shouldLoadComments settings ready.request then
                Api.fetchReviewComments ready.request.pullUrl (CommentsLoaded ready.session) (CommentsFailed ready.session)

            else
                Effect.none

        Nothing ->
            Effect.none


revisionEffect : Model -> Effect Msg
revisionEffect model =
    case readyState model of
        Just ready ->
            case ready.request.location.target of
                PullRequest _ _ _ ->
                    Api.checkRevision ready.request.requestUrl (Review.backingHeadOid ready.document.backing) (RevisionLoaded ready.session) (RevisionFailed ready.session)

                _ ->
                    Effect.none

        Nothing ->
            Effect.none


revisionCheck : Model -> ( Model, Effect Msg )
revisionCheck model =
    case readyState model of
        Just ready ->
            case ready.request.location.target of
                PullRequest _ _ _ ->
                    let
                        updated =
                            mapCollaboration Collaboration.beginRevision model
                    in
                    ( updated, revisionEffect updated )

                _ ->
                    unchanged model

        Nothing ->
            unchanged model


shouldLoadComments : Settings -> ReviewRequest -> Bool
shouldLoadComments settings request =
    settings.showGitHubReviews && Route.isPullRequest request.location.target && request.location.commit == Nothing


beginCommentsIfNeeded : Settings -> Model -> Model
beginCommentsIfNeeded settings model =
    case readyState model of
        Just ready ->
            if shouldLoadComments settings ready.request then
                mapCollaboration Collaboration.beginComments model

            else
                model

        Nothing ->
            model


beginRevisionIfNeeded : Model -> Model
beginRevisionIfNeeded model =
    case readyState model of
        Just ready ->
            if Route.isPullRequest ready.request.location.target then
                mapCollaboration Collaboration.beginRevision model

            else
                model

        Nothing ->
            model


settingsIntent : Settings -> Msg -> Maybe Settings
settingsIntent settings msg =
    case msg of
        ToggledSidebar ->
            Just { settings | sidebarCollapsed = not settings.sidebarCollapsed }

        SelectedScope scope ->
            Just { settings | reviewScope = scope }

        SelectedViewMode mode ->
            Just { settings | viewMode = mode }

        ToggledWhitespace value ->
            Just { settings | ignoreWhitespace = value }

        ToggledSemantic value ->
            Just { settings | semantic = value }

        SelectedInlineMode mode ->
            Just { settings | inlineDiffMode = mode }

        ToggledSyntax value ->
            Just { settings | syntaxHighlighting = value }

        ToggledReviews value ->
            Just { settings | showGitHubReviews = value }

        SelectedMoveTarget _ _ ->
            Just { settings | reviewScope = OneFile }

        _ ->
            Nothing


readyReview : Model -> Maybe ReviewDocument
readyReview model =
    case model.review of
        ReviewReady ready ->
            Just ready.document

        _ ->
            Nothing


visibleFiles : Settings -> Model -> List FileChange
visibleFiles settings model =
    let
        searched =
            List.filter (matchesFilter model) (reviewFiles model)
    in
    case settings.reviewScope of
        FullDiff ->
            searched

        OneFile ->
            case (reviewRequest model).location.path of
                Just selected ->
                    List.filter (.path >> (==) selected) searched

                Nothing ->
                    List.take 1 searched


matchesFilter : Model -> FileChange -> Bool
matchesFilter model file =
    let
        diff =
            reviewDiff model

        filter =
            diff |> Maybe.map DiffView.filter |> Maybe.withDefault ""

        query =
            String.toLower (String.trim filter)

        haystack =
            String.toLower (file.path ++ "\n" ++ file.patch)
    in
    if query == "" then
        True

    else
        case diff |> Maybe.map DiffView.filterMode |> Maybe.withDefault Literal of
            Literal ->
                String.contains query haystack

            Regex ->
                -- Invalid regular expressions intentionally match nothing; the
                -- search control remains a pure view of this typed branch.
                Regex.fromString filter
                    |> Maybe.map (\expression -> Regex.contains expression (file.path ++ "\n" ++ file.patch))
                    |> Maybe.withDefault False


view : Settings -> Model -> Html Msg
view settings model =
    case model.review of
        ReviewLoading request ->
            loadingView request.requestUrl

        ReviewFailure _ error ->
            section [ class "review-load-error", attribute "role" "alert" ]
                [ strong [] [ text "Could not load this change" ]
                , p [] [ text (ApiError.message error) ]
                , button [ type_ "button", onClick Refreshed ] [ text "Try again" ]
                ]

        ReviewReady ready ->
            readyView settings model ready.document


loadingView : String -> Html Msg
loadingView url =
    section [ class "review-loading", attribute "role" "status" ]
        [ div [ class "review-loading-card" ]
            [ span [ class "review-loading-spinner" ] []
            , div [ class "review-loading-copy" ]
                [ strong [] [ text "Loading the latest change…" ]
                , code [] [ text (String.replace "https://github.com/" "" url) ]
                , span [] [ text "Resolving metadata and an immutable diff revision." ]
                ]
            ]
        ]


readyView : Settings -> Model -> ReviewDocument -> Html Msg
readyView settings model reviewData =
    let
        currentLocation =
            (reviewRequest model).location
    in
    main_ [ class "review-page review-grid" ]
        [ reviewHeader model reviewData
        , reviewToolbar settings model
        , case currentLocation.tab of
            ReviewCommits ->
                case currentLocation.commit of
                    Just sha ->
                        div [ class "commit-diff-view" ]
                            [ div [ class "commit-detail" ]
                                [ button [ type_ "button", onClick (SelectedTab ReviewCommits) ] [ text "← All commits" ]
                                , h1 [] [ text ("Commit " ++ String.left 12 sha) ]
                                ]
                            , reviewWorkspace settings model
                            ]

                    Nothing ->
                        commitsView model

            ReviewFiles ->
                reviewWorkspace settings model
        , if Route.isPullRequest currentLocation.target && currentLocation.commit == Nothing then
            reviewComposer model

          else
            text ""
        ]


reviewHeader : Model -> ReviewDocument -> Html Msg
reviewHeader model reviewData =
    let
        files =
            reviewFiles model

        revision =
            reviewCollaboration model
                |> Maybe.map Collaboration.revision
                |> Maybe.withDefault NotAsked
    in
    header [ class "review-header" ]
        [ div [ class "review-header-copy" ]
            [ div [ class "review-kicker" ]
                [ a [ href ("/" ++ reviewData.repository) ] [ text reviewData.repository ]
                , span [] [ text ("#" ++ reviewData.number) ]
                , backingBadge reviewData
                ]
            , h1 [] [ text reviewData.title ]
            , p [] [ text (reviewData.author ++ " wants to merge "), code [] [ text reviewData.head ], text " into ", code [] [ text reviewData.base ] ]
            ]
        , div [ class "review-summary" ]
            [ metric (String.fromInt (List.length files)) "files" ""
            , metric ("+" ++ String.fromInt (List.sum (List.map .additions files))) "added" "is-addition"
            , metric ("−" ++ String.fromInt (List.sum (List.map .deletions files))) "removed" "is-deletion"
            , button [ type_ "button", attribute "title" "Refresh diff from GitHub", onClick Refreshed ] [ text "Refresh" ]
            ]
        , revisionNotice revision
        ]


backingBadge : ReviewDocument -> Html Msg
backingBadge reviewData =
    case Review.backingLocalPath reviewData.backing of
        Just _ ->
            span [ class "backing-badge is-local" ] [ text ("local · " ++ String.left 8 (Review.backingHeadOid reviewData.backing)) ]

        Nothing ->
            span [ class "backing-badge is-github" ] [ text "GitHub" ]


metric : String -> String -> String -> Html msg
metric amount description extra =
    div [ class ("review-metric " ++ extra) ] [ strong [] [ text amount ], span [] [ text description ] ]


revisionNotice : Remote Session.Id ApiError Revision -> Html Msg
revisionNotice revision =
    case revision of
        Success _ value ->
            case value of
                GitHubRevision ->
                    text ""

                LocalRevision details ->
                    if details.current then
                        text ""

                    else
                        div [ class "revision-notice" ]
                            [ span [] [ text "A newer revision is available." ]
                            , button [ type_ "button", onClick Refreshed ] [ text "Load latest" ]
                            ]

        Failure _ error ->
            div [ class "revision-notice is-error" ] [ text (ApiError.message error) ]

        _ ->
            text ""


reviewToolbar : Settings -> Model -> Html Msg
reviewToolbar settings model =
    let
        currentLocation =
            (reviewRequest model).location

        diff =
            reviewDiff model

        filterMode =
            diff |> Maybe.map DiffView.filterMode |> Maybe.withDefault Literal

        filter =
            diff |> Maybe.map DiffView.filter |> Maybe.withDefault ""
    in
    ToolbarView.view
        { settings = settings
        , pullRequest = Route.isPullRequest currentLocation.target
        , tab = currentLocation.tab
        , filter = filter
        , searchMode = filterMode
        , selectTab = SelectedTab
        , changeFilter = ChangedFilter
        , selectSearchMode = SelectedSearchMode
        , selectScope = SelectedScope
        , selectViewMode = SelectedViewMode
        , toggleWhitespace = ToggledWhitespace
        , toggleSemantic = ToggledSemantic
        , selectInlineMode = SelectedInlineMode
        , toggleSyntax = ToggledSyntax
        , toggleReviews = ToggledReviews
        }


reviewWorkspace : Settings -> Model -> Html Msg
reviewWorkspace settings model =
    let
        files =
            reviewFiles model
    in
    div
        [ class
            ("workspace"
                ++ (if settings.sidebarCollapsed then
                        " sidebar-collapsed"

                    else
                        ""
                   )
            )
        ]
        [ aside [ class "file-sidebar", attribute "data-viewport-scroll-region" "" ]
            [ button
                [ type_ "button"
                , class "sidebar-toggle"
                , attribute "title"
                    (if settings.sidebarCollapsed then
                        "Expand file sidebar"

                     else
                        "Collapse file sidebar"
                    )
                , onClick ToggledSidebar
                ]
                [ text
                    (if settings.sidebarCollapsed then
                        "›"

                     else
                        "‹"
                    )
                ]
            , if settings.sidebarCollapsed then
                text ""

              else
                div [ class "file-sidebar-content" ]
                    [ header [] [ strong [] [ text "Changed files" ], span [ class "count-badge" ] [ text (String.fromInt (List.length files)) ] ]
                    , div [ class "file-sidebar-tree" ] [ reviewFileTree model (FileTree.build .path files) ]
                    ]
            ]
        , Keyed.node "section"
            [ class
                ("review-diffs"
                    ++ (if settings.reviewScope == FullDiff then
                            " full-diff"

                        else
                            ""
                       )
                )
            ]
            (if List.isEmpty (visibleFiles settings model) then
                [ ( "empty", div [ class "empty-diff" ] [ h1 [] [ text "No matching files" ], p [] [ text "Change or clear the review search." ] ] ) ]

             else
                List.map
                    (\file -> ( file.path, renderFileDiff settings model file ))
                    (visibleFiles settings model)
            )
        ]


renderFileDiff : Settings -> Model -> FileChange -> Html Msg
renderFileDiff settings model file =
    case readyState model of
        Just ready ->
            case
                ( FileIndex.get file.path (Analysis.files ready.analysis)
                , DiffView.fileState file.path ready.diff
                , Collaboration.fileState file.path ready.collaboration
                )
            of
                ( Just analyzedFile, Just diffFile, Just collaborationFile ) ->
                    Lazy.lazy8 DiffPanelView.view
                        diffPanelActions
                        settings
                        (Route.isPullRequest ready.request.location.target)
                        ("https://github.com/" ++ ready.document.repository ++ "/blob/" ++ Review.backingHeadOid ready.document.backing ++ "/" ++ file.path)
                        (Analysis.status ready.analysis)
                        analyzedFile
                        diffFile
                        collaborationFile

                _ ->
                    text ""

        Nothing ->
            text ""


reviewFileTree : Model -> List (FileTree.Tree FileChange) -> Html Msg
reviewFileTree model forest =
    let
        diff =
            reviewDiff model
    in
    FileTreeView.view
        { selectedPath = Maybe.withDefault "" (reviewRequest model).location.path
        , isReviewed = \path -> diff |> Maybe.map (DiffView.isReviewed path) |> Maybe.withDefault False
        , isCollapsed = \path -> diff |> Maybe.map (DiffView.isFolderCollapsed path) |> Maybe.withDefault False
        , toggleFolder = ToggledFolder
        , selectFile = SelectedFile
        , statusGlyph = statusGlyph
        }
        forest


commitsView : Model -> Html Msg
commitsView model =
    section [ class "commits-view" ]
        [ case (reviewRequest model).location.commit of
            Just selectedSha ->
                div [ class "commit-detail" ]
                    [ button [ type_ "button", onClick (SelectedTab ReviewCommits) ] [ text "← All commits" ]
                    , h1 [] [ text ("Commit " ++ String.left 12 selectedSha) ]
                    , p [] [ text "This immutable commit diff is loaded through the same review endpoint." ]
                    ]

            Nothing ->
                case reviewCommits model of
                    Loading _ ->
                        pageState "Loading commits…"

                    Failure _ error ->
                        div [ class "page-state is-error" ] [ text (ApiError.message error) ]

                    Success _ commits ->
                        div [ class "commit-list" ] (List.map commitRow commits)

                    NotAsked ->
                        pageState "Loading commits…"
        ]


commitRow : PullCommit -> Html Msg
commitRow commit =
    button [ type_ "button", class "commit-row", onClick (SelectedCommit commit.sha) ]
        [ if commit.avatarUrl == "" then
            text ""

          else
            Html.img [ class "commit-avatar", Html.Attributes.src commit.avatarUrl ] []
        , div [] [ strong [] [ text commit.message ], span [] [ text (commit.author ++ " · " ++ commit.authoredAt) ] ]
        , code [] [ text (String.left 8 commit.sha) ]
        ]


reviewComposer : Model -> Html Msg
reviewComposer model =
    case reviewCollaboration model of
        Nothing ->
            text ""

        Just collaboration ->
            CollaborationView.reviewComposer collaborationActions collaboration


collaborationActions : CollaborationView.Actions Msg
collaborationActions =
    { toggleThread = ToggledThread
    , changeReply = ChangedReply
    , submitReply = SubmittedReply
    , changeInlineBody = ChangedInlineBody
    , cancelInline = CancelledInlineComposer
    , submitInline = SubmittedInlineComment
    , changeReviewBody = ChangedReviewBody
    , submitReview = SubmittedReview
    }


diffPanelActions : DiffPanelView.Actions Msg
diffPanelActions =
    { toggleFile = ToggledFile
    , toggleFullFile = ToggledFullFile
    , toggleReviewed = ToggledReviewed
    , toggleHunk = ToggledHunk
    , toggleSourceFold = ToggledSourceFold
    , selectMoveTarget = SelectedMoveTarget
    , openInlineComposer = OpenedInlineComposer
    , collaboration = collaborationActions
    }


statusGlyph : FileStatus -> String
statusGlyph status =
    case status of
        FileAdded ->
            "A"

        FileDeleted ->
            "D"

        FileRenamed ->
            "R"

        FileModified ->
            "M"


pageState : String -> Html msg
pageState message =
    div [ class "page-state" ] [ span [ class "loading-spinner" ] [], text message ]


unchanged : Model -> ( Model, Effect Msg )
unchanged model =
    ( model, Effect.none )
