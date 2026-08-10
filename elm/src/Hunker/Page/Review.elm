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

import Dict exposing (Dict)
import Html exposing (Html, a, article, aside, button, code, div, footer, form, h1, h2, header, input, label, main_, option, p, pre, section, select, span, strong, text, textarea)
import Html.Attributes exposing (attribute, checked, class, disabled, href, id, placeholder, selected, type_, value)
import Html.Events exposing (onCheck, onClick, onInput, onSubmit)
import Hunker.Api as Api
import Hunker.ApiError as ApiError exposing (ApiError)
import Hunker.Diff as Diff exposing (DiffLine, Hunk, Kind(..), SideLine, SplitRow)
import Hunker.Domain.Review as Review exposing (AnalysisFeature(..), AnalysisSnapshot, CharacterRange, CommentSide(..), FileChange, FileStatus(..), FullFile, MovedBlock, PullCommit, ReviewComment, ReviewDocument, Revision(..), SemanticChange(..), SemanticResult(..))
import Hunker.Domain.Settings as Settings exposing (InlineDiffMode(..), ReviewScope(..), Settings, ViewMode(..))
import Hunker.Effect as Effect exposing (Effect)
import Hunker.FileTree as FileTree exposing (Tree(..))
import Hunker.PreparedDiff as PreparedDiff exposing (PreparedFile)
import Hunker.Remote as Remote exposing (Remote(..))
import Hunker.Review.Analysis as Analysis
import Hunker.Review.Collaboration as Collaboration
import Hunker.Review.DiffView as DiffView exposing (SearchMode(..))
import Hunker.Review.FileIndex as FileIndex exposing (FileIndex)
import Hunker.Review.Session as Session
import Hunker.Route as Route exposing (ReviewTab(..), ReviewTarget(..))
import Hunker.SemanticMove as SemanticMove exposing (Endpoint(..))
import Hunker.Syntax as Syntax
import Markdown
import Regex
import Set exposing (Set)
import Time
import Url


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
    , files : FileIndex
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
        ( mapReviewRequest (\request -> { request | location = nextLocation }) model, Effect.none )


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
        |> Maybe.map (.files >> FileIndex.changes)
        |> Maybe.withDefault []


reviewAnalysis : Model -> Analysis.State
reviewAnalysis model =
    readyState model
        |> Maybe.map .analysis
        |> Maybe.withDefault Analysis.disabled


reviewCollaboration : Model -> Maybe Collaboration.Model
reviewCollaboration model =
    readyState model |> Maybe.map .collaboration


reviewComments : Model -> Remote Session.Id ApiError (List ReviewComment)
reviewComments model =
    reviewCollaboration model
        |> Maybe.map Collaboration.comments
        |> Maybe.withDefault NotAsked


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
            unchanged model

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
            if Analysis.matches requested (reviewAnalysis model) then
                ( mapReady
                    (\ready ->
                        { ready
                            | analysis = Analysis.complete requested snapshot ready.analysis
                            , files = FileIndex.withAnalysis snapshot ready.files
                        }
                    )
                    model
                , Effect.none
                )

            else
                unchanged model

        AnalysisFailed requested error ->
            if Analysis.matches requested (reviewAnalysis model) then
                ( mapReady (\ready -> { ready | analysis = Analysis.fail requested error ready.analysis }) model, Effect.none )

            else
                unchanged model

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
            , Effect.batch [ navigation, Effect.Focus anchor CheckedRevision ]
            )

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
                        , files = FileIndex.fromChanges files
                        , analysis = Analysis.disabled
                        , collaboration = Collaboration.init sessionId (Route.isPullRequest request.location.target)
                        , diff = DiffView.init sessionId
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
            if not settings.semantic && settings.inlineDiffMode == InlineOff then
                ( mapReady (\current -> { current | analysis = Analysis.disabled, files = FileIndex.clearWordRanges current.files }) model
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
                            settings.inlineDiffMode
                in
                ( mapReady (\current -> { current | analysis = Analysis.inFlight identity, files = FileIndex.clearWordRanges current.files }) model
                , Api.fetchAnalysis ready.request.requestUrl
                    ready.document.backing
                    settings.ignoreWhitespace
                    settings.semantic
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
    section
        [ class "compact-review-toolbar" ]
        [ div [ class "review-tab-picker" ]
            [ segment (currentLocation.tab == ReviewFiles) (SelectedTab ReviewFiles) "Files"
            , if Route.isPullRequest currentLocation.target then
                segment (currentLocation.tab == ReviewCommits) (SelectedTab ReviewCommits) "Commits"

              else
                text ""
            ]
        , label [ class "review-search" ]
            [ span [] [ text "⌕" ]
            , select [ onInput (searchModeFromString >> SelectedSearchMode) ]
                [ option [ value "literal", selected (filterMode == Literal) ] [ text "Text" ]
                , option [ value "regex", selected (filterMode == Regex) ] [ text "Regex" ]
                ]
            , input [ type_ "search", attribute "aria-label" "Search this change", placeholder "Search this change", value filter, onInput ChangedFilter ] []
            ]
        , div [ class "diff-options" ]
            [ select [ attribute "aria-label" "Diff scope", onInput (scopeFromString >> SelectedScope) ]
                [ option [ value "file", selected (settings.reviewScope == OneFile) ] [ text "One file" ]
                , option [ value "full", selected (settings.reviewScope == FullDiff) ] [ text "Full diff" ]
                ]
            , select [ attribute "aria-label" "Diff layout", onInput (viewModeFromString >> SelectedViewMode) ]
                [ option [ value "split", selected (settings.viewMode == Split) ] [ text "Side by side" ]
                , option [ value "unified", selected (settings.viewMode == Unified) ] [ text "Unified" ]
                ]
            , toggle "Ignore whitespace" settings.ignoreWhitespace ToggledWhitespace
            , toggle "Semantic" settings.semantic ToggledSemantic
            , select [ attribute "aria-label" "Inline diff", onInput (Settings.inlineDiffModeFromString >> SelectedInlineMode) ]
                [ option [ value "token", selected (settings.inlineDiffMode == Token) ] [ text "Word diff" ]
                , option [ value "character", selected (settings.inlineDiffMode == Character) ] [ text "Character diff" ]
                , option [ value "off", selected (settings.inlineDiffMode == InlineOff) ] [ text "Inline off" ]
                ]
            , toggle "Syntax" settings.syntaxHighlighting ToggledSyntax
            , if Route.isPullRequest currentLocation.target then
                toggle "GitHub reviews" settings.showGitHubReviews ToggledReviews

              else
                text ""
            ]
        ]


toggle : String -> Bool -> (Bool -> Msg) -> Html Msg
toggle labelText current toMsg =
    label [ class ("filter-toggle" ++ activeClass current) ]
        [ input [ type_ "checkbox", checked current, onCheck toMsg ] []
        , span [ class "toggle-dot" ] []
        , text labelText
        ]


segment : Bool -> Msg -> String -> Html Msg
segment active message labelText =
    button [ type_ "button", class ("segmented-button" ++ activeClass active), onClick message ] [ text labelText ]


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
        [ aside [ class "file-sidebar" ]
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
                div []
                    [ header [] [ strong [] [ text "Changed files" ], span [ class "count-badge" ] [ text (String.fromInt (List.length files)) ] ]
                    , reviewFileTree model (FileTree.build .path files)
                    ]
            ]
        , section
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
                [ div [ class "empty-diff" ] [ h1 [] [ text "No matching files" ], p [] [ text "Change or clear the review search." ] ] ]

             else
                List.map (fileDiff settings model) (visibleFiles settings model)
            )
        ]


reviewFileTree : Model -> List (Tree FileChange) -> Html Msg
reviewFileTree model forest =
    div [ class "file-tree" ] (List.map (reviewTreeNode model 0) forest)


reviewTreeNode : Model -> Int -> Tree FileChange -> Html Msg
reviewTreeNode model depth tree =
    case tree of
        Folder name path children ->
            let
                collapsed =
                    reviewDiff model
                        |> Maybe.map (DiffView.isFolderCollapsed path)
                        |> Maybe.withDefault False
            in
            div [ class "file-tree-folder" ]
                [ button
                    [ type_ "button"
                    , class "folder-row"
                    , attribute "style" ("padding-left:" ++ String.fromInt (depth * 14 + 8) ++ "px")
                    , onClick (ToggledFolder path)
                    ]
                    [ span [ class "folder-chevron" ]
                        [ text
                            (if collapsed then
                                "›"

                             else
                                "⌄"
                            )
                        ]
                    , span [ class "folder-icon" ] [ text "▰" ]
                    , span [] [ text name ]
                    , span [ class "tree-count" ] [ text (String.fromInt (treeFileCount tree)) ]
                    ]
                , if collapsed then
                    text ""

                  else
                    div [] (List.map (reviewTreeNode model (depth + 1)) children)
                ]

        Leaf name file ->
            let
                selectedPath =
                    Maybe.withDefault "" (reviewRequest model).location.path

                reviewed =
                    reviewDiff model
                        |> Maybe.map (DiffView.isReviewed file.path)
                        |> Maybe.withDefault False
            in
            button
                [ type_ "button"
                , class ("file-row" ++ activeClass (file.path == selectedPath))
                , attribute "style" ("padding-left:" ++ String.fromInt (depth * 14 + 20) ++ "px")
                , onClick (SelectedFile file.path)
                ]
                [ span [ class ("file-status status-" ++ Review.fileStatusToString file.status) ]
                    [ text
                        (if reviewed then
                            "✓"

                         else
                            statusGlyph file.status
                        )
                    ]
                , span [ class "file-copy" ] [ span [ class "file-name" ] [ text name ] ]
                , span [ class "file-delta" ] [ span [ class "plus" ] [ text ("+" ++ String.fromInt file.additions) ], span [ class "minus" ] [ text ("−" ++ String.fromInt file.deletions) ] ]
                ]


fileDiff : Settings -> Model -> FileChange -> Html Msg
fileDiff settings model file =
    let
        collapsed =
            reviewDiff model
                |> Maybe.map (DiffView.isFileCollapsed file.path)
                |> Maybe.withDefault False

        fullFile =
            reviewDiff model |> Maybe.andThen (DiffView.fullFile file.path)

        reviewed =
            reviewDiff model
                |> Maybe.map (DiffView.isReviewed file.path)
                |> Maybe.withDefault False
    in
    article [ class ("diff-panel" ++ activeClass reviewed), id (fileAnchor file.path) ]
        [ header [ class "diff-file-header" ]
            [ button [ type_ "button", class "file-header-main", onClick (ToggledFile file.path) ]
                [ span [ class "file-collapse" ]
                    [ text
                        (if collapsed then
                            "›"

                         else
                            "⌄"
                        )
                    ]
                , span [ class ("file-status status-" ++ Review.fileStatusToString file.status) ] [ text (statusGlyph file.status) ]
                , strong [] [ text file.path ]
                , file.previousPath
                    |> Maybe.map (\path -> span [ class "previous-path" ] [ text ("from " ++ path) ])
                    |> Maybe.withDefault (text "")
                ]
            , div [ class "file-actions", attribute "data-ignore-file-collapse" "true" ]
                [ button [ type_ "button", onClick (ToggledFullFile file) ]
                    [ text
                        (case fullFile of
                            Just (Loading _) ->
                                "Loading…"

                            Just (Success _ _) ->
                                "Patch"

                            _ ->
                                "Full file"
                        )
                    ]
                , a [ href (githubFileUrl model file), attribute "title" "Open on GitHub" ] [ text "↗" ]
                , button [ type_ "button", onClick (ToggledReviewed file.path) ]
                    [ text
                        (if reviewed then
                            "Reviewed"

                         else
                            "Mark reviewed"
                        )
                    ]
                ]
            ]
        , if collapsed then
            text ""

          else
            div []
                [ semanticSummary settings model file
                , case fullFile of
                    Just (Success _ full) ->
                        fullFileDiff settings model file full

                    Just (Failure _ error) ->
                        div [ class "diff-error" ] [ text (ApiError.message error) ]

                    _ ->
                        patchDiff settings model file
                , detachedThreads model file.path
                , inlineComposerFor model file.path
                , footer [ class "diff-footer" ]
                    [ span [] [ text "End of patch" ]
                    , if Route.isPullRequest (reviewRequest model).location.target then
                        button [ type_ "button", onClick (OpenedInlineComposer file.path (lastNewLine model file.path) RightSide) ] [ text "+ Add a review comment" ]

                      else
                        text ""
                    ]
                ]
        ]


semanticSummary : Settings -> Model -> FileChange -> Html Msg
semanticSummary settings model file =
    if not settings.semantic then
        text ""

    else
        case reviewAnalysis model of
            Analysis.InFlight _ ->
                div [ class "semantic-banner is-loading" ] [ span [ class "loading-spinner" ] [], text "Analyzing syntax tree…" ]

            Analysis.Failure _ error ->
                div [ class "semantic-banner is-error" ] [ text (ApiError.message error) ]

            Analysis.Complete _ snapshot ->
                snapshot.files
                    |> Dict.get file.path
                    |> Maybe.map (.semantic >> semanticFeatureView)
                    |> Maybe.withDefault (text "")

            Analysis.Disabled ->
                text ""


semanticFeatureView : AnalysisFeature SemanticResult -> Html msg
semanticFeatureView feature =
    case feature of
        FeatureDisabled ->
            text ""

        FeatureSkipped reason ->
            div [ class "semantic-banner is-muted" ] [ strong [] [ text "Syntax analysis skipped" ], span [] [ text reason ] ]

        FeatureComplete result ->
            semanticResultView result


semanticResultView : SemanticResult -> Html msg
semanticResultView result =
    case result of
        SemanticParsed _ language semanticEqual changes ->
            div [ class "semantic-banner" ]
                [ span [ class "semantic-symbol" ] [ text "◎" ]
                , div []
                    [ strong []
                        [ text
                            (if semanticEqual then
                                "Formatting-only semantic change"

                             else
                                semanticCount changes
                            )
                        ]
                    , span [] [ text (language ++ " syntax tree") ]
                    ]
                , div [ class "semantic-chips" ] (List.map semanticChip changes)
                ]

        SemanticUnsupported _ reason ->
            div [ class "semantic-banner is-muted" ] [ strong [] [ text "Syntax analysis skipped" ], span [] [ text reason ] ]

        SemanticParseFailed _ language reason ->
            div [ class "semantic-banner is-error" ] [ strong [] [ text (language ++ " parse failed") ], span [] [ text reason ] ]


semanticChip : SemanticChange -> Html msg
semanticChip change =
    case change of
        Inserted kind label _ _ ->
            span [ class "semantic-chip is-added" ] [ text ("+ " ++ kind ++ " " ++ label) ]

        Deleted kind label _ _ ->
            span [ class "semantic-chip is-deleted" ] [ text ("− " ++ kind ++ " " ++ label) ]

        Updated kind label _ _ _ ->
            span [ class "semantic-chip is-updated" ] [ text ("~ " ++ kind ++ " " ++ label) ]

        Renamed kind oldLabel newLabel _ _ _ ->
            span [ class "semantic-chip is-renamed" ] [ text (kind ++ " " ++ oldLabel ++ " → " ++ newLabel) ]


semanticCount : List SemanticChange -> String
semanticCount changes =
    String.fromInt (List.length changes)
        ++ " semantic change"
        ++ (if List.length changes == 1 then
                ""

            else
                "s"
           )


patchDiff : Settings -> Model -> FileChange -> Html Msg
patchDiff settings model file =
    div
        [ class
            (if settings.viewMode == Split then
                "split-diff"

             else
                "unified-diff"
            )
        ]
        (List.map (hunkView settings model file) (preparedHunks model file.path))


hunkView : Settings -> Model -> FileChange -> Hunk -> Html Msg
hunkView settings model file hunk =
    let
        collapsed =
            reviewDiff model
                |> Maybe.map (DiffView.isHunkCollapsed file.path hunk.id)
                |> Maybe.withDefault False
    in
    section [ class "diff-hunk" ]
        [ button [ type_ "button", class "hunk-header", onClick (ToggledHunk file.path hunk.id) ]
            [ span []
                [ text
                    (if collapsed then
                        "›"

                     else
                        "⌄"
                    )
                ]
            , code [] [ text hunk.header ]
            ]
        , if collapsed then
            text ""

          else if settings.viewMode == Split then
            div [ class "split-lines" ] (List.map (splitRowView settings model file) (Diff.splitRows settings.ignoreWhitespace hunk))

          else
            div [ class "unified-lines" ] (hunk.lines |> List.filter (keepLine settings.ignoreWhitespace) |> List.map (unifiedLineView settings model file))
        ]


keepLine : Bool -> DiffLine -> Bool
keepLine _ _ =
    True


splitRowView : Settings -> Model -> FileChange -> SplitRow -> Html Msg
splitRowView settings model file row =
    div [ class "split-row" ]
        [ splitCell settings model file LeftSide "left" row.left
        , splitCell settings model file RightSide "right" row.right
        ]


splitCell : Settings -> Model -> FileChange -> CommentSide -> String -> Maybe SideLine -> Html Msg
splitCell settings model file side sideClass maybeLine =
    case maybeLine of
        Nothing ->
            div [ class ("split-cell " ++ sideClass ++ " is-empty") ] [ span [ class "line-number" ] [], span [ class "line-marker" ] [], code [ class "line-code" ] [] ]

        Just line ->
            let
                number =
                    Maybe.withDefault 0 line.number

                decoration =
                    moveDecoration model file.path side number
            in
            div
                [ class ("split-cell " ++ sideClass ++ " " ++ kindClass line.kind ++ decoration.className)
                , id decoration.anchorId
                ]
                [ lineNumberButton model file.path side number line.number
                , span [ class "line-marker" ] [ text (kindMarker line.kind) ]
                , code [ class "line-code" ] (highlightedLine settings model file.path side number line.text)
                , decoration.button
                , lineThreads model file.path side number
                ]


unifiedLineView : Settings -> Model -> FileChange -> DiffLine -> Html Msg
unifiedLineView settings model file line =
    let
        side =
            if line.kind == Deletion then
                LeftSide

            else
                RightSide

        number =
            case side of
                LeftSide ->
                    Maybe.withDefault 0 line.oldLine

                RightSide ->
                    Maybe.withDefault 0 line.newLine

        decoration =
            moveDecoration model file.path side number
    in
    div [ class ("unified-line " ++ kindClass line.kind ++ decoration.className), id decoration.anchorId ]
        [ span [ class "line-number old" ] [ text (maybeNumber line.oldLine) ]
        , lineNumberButton model file.path side number line.newLine
        , span [ class "line-marker" ] [ text (kindMarker line.kind) ]
        , code [ class "line-code" ] (highlightedLine settings model file.path side number line.text)
        , decoration.button
        , lineThreads model file.path side number
        ]


type alias MoveDecoration =
    { className : String
    , anchorId : String
    , button : Html Msg
    }


moveDecoration : Model -> String -> CommentSide -> Int -> MoveDecoration
moveDecoration model path side lineNumber =
    let
        endpoint =
            case side of
                LeftSide ->
                    Source

                RightSide ->
                    Destination

        move =
            case reviewAnalysis model of
                Analysis.Complete _ snapshot ->
                    List.filter (SemanticMove.containsLine path lineNumber endpoint) snapshot.moves |> List.head

                _ ->
                    Nothing
    in
    case move of
        Nothing ->
            { className = "", anchorId = "", button = text "" }

        Just moved ->
            let
                targetEndpoint =
                    if endpoint == Source then
                        Destination

                    else
                        Source

                targetPath =
                    if endpoint == Source then
                        moved.toPath

                    else
                        moved.fromPath

                ownAnchor =
                    SemanticMove.anchor moved endpoint

                targetAnchor =
                    SemanticMove.anchor moved targetEndpoint
            in
            { className = " line-move move-tone-" ++ String.fromInt (SemanticMove.tone moved)
            , anchorId = ownAnchor
            , button =
                button
                    [ type_ "button"
                    , class "semantic-move-link"
                    , attribute "title" ("Jump to moved " ++ moved.kind ++ " " ++ moved.label)
                    , onClick (SelectedMoveTarget targetPath targetAnchor)
                    ]
                    [ text
                        (if endpoint == Source then
                            "Moved →"

                         else
                            "← From"
                        )
                    ]
            }


lineNumberButton : Model -> String -> CommentSide -> Int -> Maybe Int -> Html Msg
lineNumberButton model path side number maybeNumberValue =
    if Route.isPullRequest (reviewRequest model).location.target && maybeNumberValue /= Nothing then
        button [ type_ "button", class "line-number comment-trigger", attribute "title" "Add a GitHub review comment", onClick (OpenedInlineComposer path number side) ] [ text (maybeNumber maybeNumberValue) ]

    else
        span [ class "line-number" ] [ text (maybeNumber maybeNumberValue) ]


highlightedLine : Settings -> Model -> String -> CommentSide -> Int -> String -> List (Html Msg)
highlightedLine settings model path side number source =
    case readyState model |> Maybe.andThen (.files >> FileIndex.get path) of
        Just prepared ->
            rangedSyntax settings.syntaxHighlighting path source (PreparedDiff.rangesFor side number prepared)

        Nothing ->
            Syntax.line settings.syntaxHighlighting path source


rangedSyntax : Bool -> String -> String -> List CharacterRange -> List (Html Msg)
rangedSyntax syntax path source ranges =
    if List.isEmpty ranges then
        Syntax.line syntax path source

    else
        ranges
            |> List.sortBy .start
            |> rangesToSegments 0 source


rangesToSegments : Int -> String -> List CharacterRange -> List (Html msg)
rangesToSegments offset source ranges =
    case ranges of
        [] ->
            [ text (String.dropLeft offset source) ]

        range :: remaining ->
            let
                safeStart =
                    max offset range.start

                safeEnd =
                    max safeStart range.end
            in
            [ text (String.slice offset safeStart source)
            , span [ class "inline-change" ] [ text (String.slice safeStart safeEnd source) ]
            ]
                ++ rangesToSegments safeEnd source remaining


lineThreads : Model -> String -> CommentSide -> Int -> Html Msg
lineThreads model path side lineNumber =
    case reviewComments model of
        Success _ comments ->
            comments
                |> rootComments
                |> List.filter (\comment -> comment.path == path && comment.side == side && comment.line == Just lineNumber)
                |> List.map (threadView model comments)
                |> div [ class "inline-review-threads" ]

        _ ->
            text ""


detachedThreads : Model -> String -> Html Msg
detachedThreads model path =
    case reviewComments model of
        Success _ comments ->
            comments
                |> rootComments
                |> List.filter (\comment -> comment.path == path && comment.line == Nothing)
                |> List.map (threadView model comments)
                |> div [ class "detached-review-threads" ]

        Failure _ error ->
            div [ class "review-comments-error" ] [ text (ApiError.message error) ]

        _ ->
            text ""


rootComments : List ReviewComment -> List ReviewComment
rootComments =
    List.filter (\comment -> comment.id == comment.rootId)


threadView : Model -> List ReviewComment -> ReviewComment -> Html Msg
threadView model comments root =
    let
        collapsed =
            reviewCollaboration model
                |> Maybe.map (Collaboration.isThreadCollapsed root.rootId)
                |> Maybe.withDefault False

        replies =
            List.filter (\comment -> comment.rootId == root.rootId && comment.id /= root.id) comments
    in
    article
        [ class
            ("github-review-thread"
                ++ (if root.resolved then
                        " is-resolved"

                    else
                        ""
                   )
            )
        ]
        [ button [ type_ "button", class "review-thread-header", onClick (ToggledThread root.rootId) ]
            [ span []
                [ text
                    (if collapsed then
                        "›"

                     else
                        "⌄"
                    )
                ]
            , strong [] [ text root.author ]
            , if root.resolved then
                span [ class "resolved-tag" ] [ text "Resolved" ]

              else
                text ""
            , span [] [ text root.createdAt ]
            ]
        , if collapsed then
            text ""

          else
            div [ class "review-thread-body" ]
                (Markdown.toHtml [ class "github-markdown" ] root.body
                    :: List.map (commentBody False) replies
                    ++ [ replyComposer model root.rootId ]
                )
        ]


commentBody : Bool -> ReviewComment -> Html msg
commentBody _ comment =
    div [ class "github-review-reply" ]
        [ header [] [ strong [] [ text comment.author ], span [] [ text comment.createdAt ] ]
        , Markdown.toHtml [ class "github-markdown" ] comment.body
        ]


replyComposer : Model -> Int -> Html Msg
replyComposer model commentId =
    let
        collaboration =
            reviewCollaboration model

        draft =
            collaboration
                |> Maybe.map (Collaboration.replyDraft commentId)
                |> Maybe.withDefault ""

        loading =
            collaboration
                |> Maybe.map (Collaboration.replyLoading commentId)
                |> Maybe.withDefault False

        error =
            collaboration |> Maybe.andThen (Collaboration.replyError commentId)
    in
    form [ class "review-reply-composer", onSubmit (SubmittedReply commentId) ]
        [ textarea [ placeholder "Reply on GitHub…", value draft, onInput (ChangedReply commentId) ] []
        , button [ type_ "submit", disabled loading ] [ text "Reply" ]
        , apiErrorView error
        ]


inlineComposerFor : Model -> String -> Html Msg
inlineComposerFor model path =
    case reviewCollaboration model of
        Nothing ->
            text ""

        Just collaboration ->
            inlineComposerView collaboration path


inlineComposerView : Collaboration.Model -> String -> Html Msg
inlineComposerView collaboration path =
    case Collaboration.inlineComposer collaboration of
        Just composer ->
            if composer.path /= path then
                text ""

            else
                form [ class "inline-comment-composer", onSubmit SubmittedInlineComment ]
                    [ header [] [ strong [] [ text ("Comment on " ++ path ++ ":" ++ String.fromInt composer.line) ], span [] [ text (Review.commentSideToString composer.side) ] ]
                    , textarea [ id ("inline-comment-" ++ fileAnchor path), placeholder "Leave a review comment on GitHub…", value composer.body, onInput ChangedInlineBody ] []
                    , div []
                        [ button [ type_ "button", onClick CancelledInlineComposer ] [ text "Cancel" ]
                        , button [ type_ "submit", disabled (Collaboration.inlineLoading collaboration) ] [ text "Add comment" ]
                        ]
                    , apiErrorView (Collaboration.inlineError collaboration)
                    ]

        Nothing ->
            text ""


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
            form [ class "github-review-composer" ]
                [ h2 [] [ text "Submit review" ]
                , textarea [ placeholder "Leave an overall review…", value (Collaboration.reviewBody collaboration), onInput ChangedReviewBody ] []
                , div []
                    [ button [ type_ "button", onClick (SubmittedReview "COMMENT") ] [ text "Comment" ]
                    , button [ type_ "button", onClick (SubmittedReview "APPROVE") ] [ text "Approve" ]
                    , button [ type_ "button", onClick (SubmittedReview "REQUEST_CHANGES") ] [ text "Request changes" ]
                    ]
                , apiErrorView (Collaboration.reviewError collaboration)
                ]


fullFileDiff : Settings -> Model -> FileChange -> FullFile -> Html Msg
fullFileDiff settings model file full =
    let
        rows =
            Diff.fullFileRowsPrepared (preparedHunks model file.path) full.oldText full.newText
    in
    div [ class "full-file-diff" ]
        (if settings.viewMode == Split then
            List.map (splitRowView settings model file) rows

         else
            rows
                |> List.concatMap fullUnifiedLines
                |> List.map (unifiedLineView settings model file)
        )


fullUnifiedLines : SplitRow -> List DiffLine
fullUnifiedLines row =
    case ( row.left, row.right ) of
        ( Just left, Just right ) ->
            if left.kind == Context && right.kind == Context then
                [ { kind = Context, text = right.text, oldLine = left.number, newLine = right.number } ]

            else
                [ { kind = left.kind, text = left.text, oldLine = left.number, newLine = Nothing }
                , { kind = right.kind, text = right.text, oldLine = Nothing, newLine = right.number }
                ]

        ( Just left, Nothing ) ->
            [ { kind = left.kind, text = left.text, oldLine = left.number, newLine = Nothing } ]

        ( Nothing, Just right ) ->
            [ { kind = right.kind, text = right.text, oldLine = Nothing, newLine = right.number } ]

        ( Nothing, Nothing ) ->
            []


githubFileUrl : Model -> FileChange -> String
githubFileUrl model file =
    case readyReview model of
        Just reviewData ->
            "https://github.com/" ++ reviewData.repository ++ "/blob/" ++ Review.backingHeadOid reviewData.backing ++ "/" ++ file.path

        Nothing ->
            "#"


preparedHunks : Model -> String -> List Hunk
preparedHunks model path =
    readyState model
        |> Maybe.map (.files >> FileIndex.hunks path)
        |> Maybe.withDefault []


lastNewLine : Model -> String -> Int
lastNewLine model path =
    preparedHunks model path
        |> List.reverse
        |> List.head
        |> Maybe.andThen (.lines >> List.reverse >> List.filterMap .newLine >> List.head)
        |> Maybe.withDefault 1


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


kindClass : Kind -> String
kindClass kind =
    case kind of
        Addition ->
            "addition"

        Deletion ->
            "deletion"

        Context ->
            "context"


kindMarker : Kind -> String
kindMarker kind =
    case kind of
        Addition ->
            "+"

        Deletion ->
            "−"

        Context ->
            " "


maybeNumber : Maybe Int -> String
maybeNumber =
    Maybe.map String.fromInt >> Maybe.withDefault ""


fileAnchor : String -> String
fileAnchor path =
    "file-" ++ Url.percentEncode path


scopeFromString : String -> ReviewScope
scopeFromString encoded =
    if encoded == "full" then
        FullDiff

    else
        OneFile


viewModeFromString : String -> ViewMode
viewModeFromString encoded =
    if encoded == "unified" then
        Unified

    else
        Split


searchModeFromString : String -> SearchMode
searchModeFromString encoded =
    if encoded == "regex" then
        Regex

    else
        Literal


activeClass : Bool -> String
activeClass active =
    if active then
        " is-active"

    else
        ""


apiErrorView : Maybe ApiError -> Html msg
apiErrorView maybeError =
    maybeError
        |> Maybe.map (ApiError.message >> text >> List.singleton >> span [ class "form-error" ])
        |> Maybe.withDefault (text "")


pageState : String -> Html msg
pageState message =
    div [ class "page-state" ] [ span [ class "loading-spinner" ] [], text message ]


treeFileCount : Tree value -> Int
treeFileCount tree =
    case tree of
        Leaf _ _ ->
            1

        Folder _ _ children ->
            List.sum (List.map treeFileCount children)


unchanged : Model -> ( Model, Effect Msg )
unchanged model =
    ( model, Effect.none )
