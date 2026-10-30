module Hunker.Page.Review exposing
    ( Model
    , Msg(..)
    , ReadyMsg(..)
    , init
    , location
    , navigate
    , subscriptions
    , title
    , update
    , view
    )

import Html exposing (Html, a, aside, button, code, div, h1, header, main_, p, section, span, strong, text)
import Html.Attributes exposing (attribute, class, classList, disabled, href, type_)
import Html.Events exposing (onClick)
import Html.Keyed as Keyed
import Html.Lazy as Lazy
import Hunker.Api as Api
import Hunker.ApiError as ApiError exposing (ApiError)
import Hunker.Domain.Git as Git
import Hunker.Domain.Review exposing (AnalysisSnapshot, FileChange, FullFile, HeadFreshness(..), PullCommit, ReviewAction, ReviewComment, ReviewDocument, ReviewSource(..), Revision(..))
import Hunker.Domain.Settings as Settings exposing (Change, Feature(..), ReviewScope(..), Settings, Visibility(..))
import Hunker.Effect as Effect exposing (Effect)
import Hunker.FileTree as FileTree exposing (Tree)
import Hunker.Remote exposing (Remote(..))
import Hunker.Review.Analysis as Analysis
import Hunker.Review.Collaboration as Collaboration
import Hunker.Review.DiffView as DiffView exposing (SearchMode)
import Hunker.Review.FileIndex as FileIndex
import Hunker.Review.Session as Session
import Hunker.Review.View.Collaboration as CollaborationView
import Hunker.Review.View.DiffPanel as DiffPanelView
import Hunker.Review.View.FileTree as FileTreeView
import Hunker.Review.View.Toolbar as ToolbarView
import Hunker.Route as Route exposing (PullView(..), ReviewLocation, ReviewSubject(..))
import Hunker.View.Time as TimeView
import Time


revisionPollMilliseconds : Float
revisionPollMilliseconds =
    120000


type alias Model =
    { location : ReviewLocation
    , review : ReviewState
    , loads : Int
    }


type ReviewState
    = ReviewLoading Load
    | ReviewFailure Load ApiError
    | ReviewReady ReadyReview


{-| One request for a review document. The attempt counter distinguishes a
refresh from the load it replaces, so an older response cannot win.
-}
type Load
    = Load String Int


type alias ReadyReview =
    { session : Session.Id
    , document : ReviewDocument
    , tree : List (Tree FileChange)
    , analysis : Analysis.State
    , kind : ReviewKind
    , diff : DiffView.Model
    , reload : Reload
    }


{-| Only a pull request has commits, a revision to poll, and GitHub threads.
-}
type ReviewKind
    = PullReview Collaboration.Model
    | ChangeReview


{-| A refresh keeps the ready review on screen until its replacement arrives.
-}
type Reload
    = Settled
    | Reloading Load
    | ReloadFailed ApiError


type Msg
    = ReviewLoaded Load ReviewDocument
    | ReviewFailed Load ApiError
    | Refreshed
    | PollRevision Time.Posix
    | ReadyMsg ReadyMsg


{-| Messages that only a ready review can receive.
-}
type ReadyMsg
    = ChangedSetting Change
    | SelectedPullView PullView
    | SelectedFile String
    | ChangedFilter String
    | SelectedSearchMode SearchMode
    | ToggledFolder String
    | ToggledDiffOptions
    | ClosedDiffOptions
    | AnalysisLoaded Analysis.Identity AnalysisSnapshot
    | AnalysisFailed Analysis.Identity ApiError
    | ToggledFullFile String
    | FullFileLoaded DiffView.FullFileRequest FullFile
    | FullFileFailed DiffView.FullFileRequest ApiError
    | ToggledFile String
    | ToggledHunk String String
    | ToggledSourceFold String String
    | ToggledReviewed String
    | SelectedMoveTarget String String
    | ScrolledToLocation
    | CommitsLoaded Session.Id (List PullCommit)
    | CommitsFailed Session.Id ApiError
    | RevisionLoaded Session.Id Revision
    | RevisionFailed Session.Id ApiError
    | CommentsLoaded Session.Id (List ReviewComment)
    | CommentsFailed Session.Id ApiError
    | ToggledThread String Int
    | ChangedReply String Int String
    | SubmittedReply String Int
    | ReplyLoaded Collaboration.ReplyRequest ReviewComment
    | ReplyFailed Collaboration.ReplyRequest ApiError
    | ChangedReviewBody String
    | SubmittedReview ReviewAction
    | ReviewSubmitted Collaboration.ReviewRequest ReviewAction
    | ReviewSubmitFailed Collaboration.ReviewRequest ApiError
    | OpenedInlineComposer Collaboration.Anchor
    | ChangedInlineBody String String
    | CancelledInlineComposer String
    | SubmittedInlineComment String
    | InlineCommentLoaded Collaboration.InlineRequest ReviewComment
    | InlineCommentFailed Collaboration.InlineRequest ApiError


init : ReviewLocation -> ( Model, Effect Msg )
init reviewLocation =
    let
        load =
            Load (Route.diffUrl reviewLocation) 1
    in
    ( { location = reviewLocation, review = ReviewLoading load, loads = 1 }, fetch load )


fetch : Load -> Effect Msg
fetch ((Load url _) as load) =
    Api.fetchReview url (ReviewLoaded load) (ReviewFailed load)


{-| Issues the next load of this page's diff with a fresh attempt number.
-}
nextLoad : Model -> ( Model, Load )
nextLoad model =
    ( { model | loads = model.loads + 1 }, Load (Route.diffUrl model.location) (model.loads + 1) )


location : Model -> ReviewLocation
location model =
    model.location


{-| Moves within the same immutable diff without reloading it. A location
that selects another file scrolls that panel into view.
-}
navigate : ReviewLocation -> Model -> ( Model, Effect Msg )
navigate nextLocation model =
    if not (Route.sameDiff nextLocation model.location) then
        init nextLocation

    else
        ( { model | location = nextLocation }
        , if Route.selectedPath nextLocation == Route.selectedPath model.location then
            Effect.none

          else
            Route.selectedPath nextLocation
                |> Maybe.map (\path -> Effect.ScrollIntoView (DiffPanelView.fileAnchor path) (ReadyMsg ScrolledToLocation))
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
    case model.review of
        ReviewReady { kind } ->
            case kind of
                PullReview _ ->
                    Time.every revisionPollMilliseconds PollRevision

                ChangeReview ->
                    Sub.none

        ReviewLoading _ ->
            Sub.none

        ReviewFailure _ _ ->
            Sub.none



-- UPDATE


{-| Returns the settings changes this message asks Main to persist.
-}
update : Settings -> Msg -> Model -> ( Model, Effect Msg, List Change )
update settings msg model =
    case ( msg, model.review ) of
        ( ReviewLoaded load document, ReviewLoading active ) ->
            if load == active then
                withoutChanges (startReady settings document model)

            else
                unchanged model

        ( ReviewLoaded load document, ReviewReady ready ) ->
            if ready.reload == Reloading load then
                withoutChanges (finishReload settings document ready model)

            else
                unchanged model

        ( ReviewLoaded _ _, ReviewFailure _ _ ) ->
            unchanged model

        ( ReviewFailed load error, ReviewLoading active ) ->
            if load == active then
                ( { model | review = ReviewFailure load error }, Effect.none, [] )

            else
                unchanged model

        ( ReviewFailed load error, ReviewReady ready ) ->
            if ready.reload == Reloading load then
                ( { model | review = ReviewReady { ready | reload = ReloadFailed error } }, Effect.none, [] )

            else
                unchanged model

        ( ReviewFailed _ _, ReviewFailure _ _ ) ->
            unchanged model

        ( Refreshed, ReviewLoading _ ) ->
            unchanged model

        ( Refreshed, ReviewFailure _ _ ) ->
            let
                ( counted, retry ) =
                    nextLoad model
            in
            ( { counted | review = ReviewLoading retry }, fetch retry, [] )

        ( Refreshed, ReviewReady ready ) ->
            case ready.reload of
                Reloading _ ->
                    unchanged model

                Settled ->
                    reload ready model

                ReloadFailed _ ->
                    reload ready model

        ( PollRevision _, ReviewReady ready ) ->
            let
                ( checked, effect ) =
                    checkRevision ready
            in
            ( { model | review = ReviewReady checked }, effect, [] )

        ( PollRevision _, ReviewLoading _ ) ->
            unchanged model

        ( PollRevision _, ReviewFailure _ _ ) ->
            unchanged model

        ( ReadyMsg readyMsg, ReviewReady ready ) ->
            updateReady settings readyMsg ready model

        -- A ready message can only arrive late from a review that has since
        -- been replaced by a reload.
        ( ReadyMsg _, ReviewLoading _ ) ->
            unchanged model

        ( ReadyMsg _, ReviewFailure _ _ ) ->
            unchanged model


reload : ReadyReview -> Model -> ( Model, Effect Msg, List Change )
reload ready model =
    let
        ( counted, load ) =
            nextLoad model
    in
    ( { counted | review = ReviewReady { ready | reload = Reloading load } }, fetch load, [] )


updateReady : Settings -> ReadyMsg -> ReadyReview -> Model -> ( Model, Effect Msg, List Change )
updateReady settings msg ready model =
    let
        set next =
            ( { model | review = ReviewReady next }, Effect.none, [] )

        withEffect ( next, effect ) =
            ( { model | review = ReviewReady next }, effect, [] )

        mapDiff transform =
            set { ready | diff = transform ready.diff }

        mapPull transform =
            case ready.kind of
                PullReview collaboration ->
                    set { ready | kind = PullReview (transform collaboration) }

                ChangeReview ->
                    unchanged model

        startPull start =
            case ready.kind of
                PullReview collaboration ->
                    case start collaboration of
                        Just ( next, effect ) ->
                            withEffect ( { ready | kind = PullReview next }, effect )

                        Nothing ->
                            unchanged model

                ChangeReview ->
                    unchanged model

        push nextLocation =
            ( model, Effect.PushUrl (Route.toPath (Route.Review nextLocation)), [] )
    in
    case msg of
        ChangedSetting change ->
            let
                next =
                    Settings.apply change settings

                ( analyzed, analysisEffect ) =
                    if Settings.analysisOptions next /= Settings.analysisOptions settings then
                        beginAnalysis next ready

                    else
                        ( ready, Effect.none )

                ( withComments, commentsEffect ) =
                    if settings.gitHubReviews == Disabled && next.gitHubReviews == Enabled then
                        beginComments next analyzed

                    else
                        ( analyzed, Effect.none )
            in
            ( { model | review = ReviewReady withComments }, Effect.batch [ analysisEffect, commentsEffect ], [ change ] )

        SelectedPullView pullView ->
            case model.location.subject of
                PullRequest number _ ->
                    push { repository = model.location.repository, subject = PullRequest number pullView }

                Compare _ _ ->
                    unchanged model

                Commit _ _ ->
                    unchanged model

        SelectedFile path ->
            push (Route.selectFile path model.location)

        ChangedFilter filter ->
            mapDiff (DiffView.changeFilter filter)

        SelectedSearchMode mode ->
            mapDiff (DiffView.selectSearchMode mode)

        ToggledFolder path ->
            mapDiff (DiffView.toggleFolder path)

        ToggledDiffOptions ->
            mapDiff DiffView.toggleOptions

        ClosedDiffOptions ->
            mapDiff DiffView.closeOptions

        AnalysisLoaded requested snapshot ->
            set { ready | analysis = Analysis.complete requested snapshot ready.analysis }

        AnalysisFailed requested error ->
            set { ready | analysis = Analysis.fail requested error ready.analysis }

        ToggledFullFile path ->
            let
                ( diff, request ) =
                    DiffView.toggleFullFile path ready.diff
            in
            withEffect
                ( { ready | diff = diff }
                , request
                    |> Maybe.map
                        (\current ->
                            Api.fetchFullFile
                                { diffUrl = Session.diffUrl ready.session, revision = ready.document.revision, path = path }
                                (ReadyMsg << FullFileLoaded current)
                                (ReadyMsg << FullFileFailed current)
                        )
                    |> Maybe.withDefault Effect.none
                )

        FullFileLoaded requested fullFile ->
            mapDiff (DiffView.fileLoaded requested fullFile)

        FullFileFailed requested error ->
            mapDiff (DiffView.fileFailed requested error)

        ToggledFile path ->
            mapDiff (DiffView.toggleFile path)

        ToggledHunk path hunkId ->
            mapDiff (DiffView.toggleHunk path hunkId)

        ToggledSourceFold path fold ->
            mapDiff (DiffView.toggleSourceFold path fold)

        ToggledReviewed path ->
            mapDiff (DiffView.toggleReviewed path)

        SelectedMoveTarget path anchor ->
            let
                nextLocation =
                    Route.selectFile path model.location
            in
            ( { model | location = nextLocation, review = ReviewReady { ready | diff = DiffView.revealFile path ready.diff } }
            , Effect.batch
                [ if nextLocation == model.location then
                    Effect.none

                  else
                    Effect.ReplaceUrl (Route.toPath (Route.Review nextLocation))
                , Effect.ScrollIntoView anchor (ReadyMsg ScrolledToLocation)
                ]
            , []
            )

        ScrolledToLocation ->
            unchanged model

        CommitsLoaded requested commits ->
            mapPull (Collaboration.commitsLoaded requested commits)

        CommitsFailed requested error ->
            mapPull (Collaboration.commitsFailed requested error)

        RevisionLoaded requested revision ->
            mapPull (Collaboration.revisionLoaded requested revision)

        RevisionFailed requested error ->
            mapPull (Collaboration.revisionFailed requested error)

        CommentsLoaded requested comments ->
            mapPull (Collaboration.commentsLoaded requested comments)

        CommentsFailed requested error ->
            mapPull (Collaboration.commentsFailed requested error)

        ToggledThread path threadId ->
            mapPull (Collaboration.toggleThread path threadId)

        ChangedReply path threadId body ->
            mapPull (Collaboration.changeReply path threadId body)

        SubmittedReply path threadId ->
            startPull
                (Collaboration.beginReply path threadId
                    >> Maybe.map
                        (Tuple.mapSecond
                            (\submission ->
                                Api.postReply submission.pull
                                    submission.commentId
                                    submission.body
                                    (ReadyMsg << ReplyLoaded submission.request)
                                    (ReadyMsg << ReplyFailed submission.request)
                            )
                        )
                )

        ReplyLoaded request comment ->
            mapPull (Collaboration.replyLoaded request comment)

        ReplyFailed request error ->
            mapPull (Collaboration.replyFailed request error)

        ChangedReviewBody body ->
            mapPull (Collaboration.changeReviewBody body)

        SubmittedReview action ->
            startPull
                (Collaboration.beginReview action
                    >> Maybe.map
                        (Tuple.mapSecond
                            (\submission ->
                                Api.submitReview submission.pull
                                    submission.body
                                    submission.action
                                    (ReadyMsg << ReviewSubmitted submission.request)
                                    (ReadyMsg << ReviewSubmitFailed submission.request)
                            )
                        )
                )

        ReviewSubmitted request accepted ->
            mapPull (Collaboration.reviewLoaded request accepted)

        ReviewSubmitFailed request error ->
            mapPull (Collaboration.reviewFailed request error)

        OpenedInlineComposer anchor ->
            mapPull (Collaboration.openInline anchor)

        ChangedInlineBody path body ->
            mapPull (Collaboration.changeInlineBody path body)

        CancelledInlineComposer path ->
            mapPull (Collaboration.cancelInline path)

        SubmittedInlineComment path ->
            startPull
                (\collaboration ->
                    Collaboration.submitInline path collaboration
                        |> Maybe.map
                            (Tuple.mapSecond
                                (\submission ->
                                    Api.postInlineComment
                                        { pull = Collaboration.pull collaboration
                                        , commitId = Session.headOid ready.session
                                        , path = submission.anchor.path
                                        , line = submission.anchor.line
                                        , side = submission.anchor.side
                                        , body = submission.body
                                        }
                                        (ReadyMsg << InlineCommentLoaded submission.request)
                                        (ReadyMsg << InlineCommentFailed submission.request)
                                )
                            )
                )

        InlineCommentLoaded request comment ->
            mapPull (Collaboration.inlineLoaded request comment)

        InlineCommentFailed request error ->
            mapPull (Collaboration.inlineFailed request error)


{-| Builds the ready review for a freshly loaded document and starts every
request it needs: analysis, and for pull requests commits, comments, and the
revision check.
-}
startReady : Settings -> ReviewDocument -> Model -> ( Model, Effect Msg )
startReady settings document model =
    let
        session =
            Session.create (Route.diffUrl model.location) document.revision.headOid

        tree =
            FileTree.build .path document.files

        -- Panels follow the sidebar's order, so scrolling the full diff
        -- walks the tree top to bottom.
        ordered =
            FileTree.leaves tree

        canonical =
            canonicalLocation ordered model.location

        initial =
            { session = session
            , document = document
            , tree = tree
            , analysis = Analysis.init (FileIndex.fromChanges ordered)
            , kind =
                case Route.pullRequest model.location of
                    Just pullRequest ->
                        PullReview (Collaboration.init session pullRequest)

                    Nothing ->
                        ChangeReview
            , diff = DiffView.init session
            , reload = Settled
            }

        ( analyzed, analysisEffect ) =
            beginAnalysis settings initial

        ( withComments, commentsEffect ) =
            beginComments settings analyzed

        ( checked, revisionEffect ) =
            checkRevision withComments
    in
    ( { model | location = canonical, review = ReviewReady checked }
    , Effect.batch
        [ if canonical == model.location then
            Effect.none

          else
            Effect.ReplaceUrl (Route.toPath (Route.Review canonical))
        , commitsEffect checked
        , analysisEffect
        , commentsEffect
        , revisionEffect
        , landOnSelection settings model.location
        ]
    )


{-| A full diff opened on a named file lands on that file's panel, as a
GitHub file anchor does. One-file scope already shows only that file.
-}
landOnSelection : Settings -> ReviewLocation -> Effect Msg
landOnSelection settings requested =
    case ( settings.reviewScope, Route.selectedPath requested ) of
        ( FullDiff, Just path ) ->
            Effect.ScrollIntoView (DiffPanelView.fileAnchor path) (ReadyMsg ScrolledToLocation)

        ( FullDiff, Nothing ) ->
            Effect.none

        ( OneFile, _ ) ->
            Effect.none


{-| A refresh at the same head keeps every draft; a new head starts over,
because drafts and inline anchors belong to the old revision.
-}
finishReload : Settings -> ReviewDocument -> ReadyReview -> Model -> ( Model, Effect Msg )
finishReload settings document ready model =
    if document.revision.headOid == Session.headOid ready.session then
        ( { model | review = ReviewReady { ready | document = document, reload = Settled } }, Effect.none )

    else
        startReady settings document model


{-| Selects the first file when the location names none or a missing one.
-}
canonicalLocation : List FileChange -> ReviewLocation -> ReviewLocation
canonicalLocation files current =
    let
        exists path =
            List.any (.path >> (==) path) files
    in
    case current.subject of
        PullRequest _ PullCommits ->
            current

        PullRequest _ (PullFiles _) ->
            selectFirst exists files current

        PullRequest _ (PullCommitFiles _ _) ->
            selectFirst exists files current

        Compare _ _ ->
            selectFirst exists files current

        Commit _ _ ->
            selectFirst exists files current


selectFirst : (String -> Bool) -> List FileChange -> ReviewLocation -> ReviewLocation
selectFirst exists files current =
    case ( Route.selectedPath current |> Maybe.map exists, files ) of
        ( Just True, _ ) ->
            current

        ( _, first :: _ ) ->
            Route.selectFile first.path current

        ( _, [] ) ->
            current


commitsEffect : ReadyReview -> Effect Msg
commitsEffect ready =
    case ready.kind of
        PullReview collaboration ->
            Api.fetchCommits (Collaboration.pull collaboration)
                (ReadyMsg << CommitsLoaded ready.session)
                (ReadyMsg << CommitsFailed ready.session)

        ChangeReview ->
            Effect.none


beginAnalysis : Settings -> ReadyReview -> ( ReadyReview, Effect Msg )
beginAnalysis settings ready =
    let
        ( analysis, request ) =
            Analysis.begin ready.session (Settings.analysisOptions settings) ready.analysis
    in
    ( { ready | analysis = analysis }
    , request
        |> Maybe.map
            (\identity ->
                Api.fetchAnalysis (Session.diffUrl ready.session)
                    ready.document.revision
                    (Settings.analysisOptions settings)
                    (ReadyMsg << AnalysisLoaded identity)
                    (ReadyMsg << AnalysisFailed identity)
            )
        |> Maybe.withDefault Effect.none
    )


{-| GitHub threads belong to the pull request, so only a review of its head
loads them.
-}
beginComments : Settings -> ReadyReview -> ( ReadyReview, Effect Msg )
beginComments settings ready =
    case ( ready.kind, settings.gitHubReviews ) of
        ( PullReview collaboration, Enabled ) ->
            startComments collaboration ready

        ( PullReview _, Disabled ) ->
            ( ready, Effect.none )

        ( ChangeReview, _ ) ->
            ( ready, Effect.none )


startComments : Collaboration.Model -> ReadyReview -> ( ReadyReview, Effect Msg )
startComments collaboration ready =
    case Collaboration.beginComments collaboration of
        Just ( next, session ) ->
            ( { ready | kind = PullReview next }
            , Api.fetchReviewComments (Collaboration.pull next)
                (ReadyMsg << CommentsLoaded session)
                (ReadyMsg << CommentsFailed session)
            )

        Nothing ->
            ( ready, Effect.none )


checkRevision : ReadyReview -> ( ReadyReview, Effect Msg )
checkRevision ready =
    case ready.kind of
        PullReview collaboration ->
            let
                ( next, session ) =
                    Collaboration.beginRevision collaboration
            in
            ( { ready | kind = PullReview next }
            , Api.checkRevision (Collaboration.pull next)
                (Session.headOid session)
                (ReadyMsg << RevisionLoaded session)
                (ReadyMsg << RevisionFailed session)
            )

        ChangeReview ->
            ( ready, Effect.none )


withoutChanges : ( Model, Effect Msg ) -> ( Model, Effect Msg, List Change )
withoutChanges ( model, effect ) =
    ( model, effect, [] )


unchanged : Model -> ( Model, Effect Msg, List Change )
unchanged model =
    ( model, Effect.none, [] )



-- VIEW


view : Settings -> Model -> Html Msg
view settings model =
    case model.review of
        ReviewLoading (Load url _) ->
            loadingView url

        ReviewFailure _ error ->
            section [ class "review-load-error", attribute "role" "alert" ]
                [ strong [] [ text "Could not load this change" ]
                , p [] [ text (ApiError.message error) ]
                , button [ type_ "button", onClick Refreshed ] [ text "Try again" ]
                ]

        ReviewReady ready ->
            readyView settings model.location ready


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


readyView : Settings -> ReviewLocation -> ReadyReview -> Html Msg
readyView settings reviewLocation ready =
    let
        workspace =
            reviewWorkspace settings reviewLocation ready
    in
    main_ [ class "review-page review-grid" ]
        [ reviewHeader reviewLocation ready
        , reviewToolbar settings reviewLocation ready
        , case reviewLocation.subject of
            PullRequest _ PullCommits ->
                commitsView ready

            PullRequest _ (PullCommitFiles sha _) ->
                div [ class "commit-diff-view" ]
                    [ div [ class "commit-detail" ]
                        [ button [ type_ "button", onClick (ReadyMsg (SelectedPullView PullCommits)) ] [ text "← All commits" ]
                        , h1 [] [ text ("Commit " ++ String.left 12 sha) ]
                        ]
                    , reviewStatus ready
                    , workspace
                    ]

            PullRequest _ (PullFiles _) ->
                div [] [ reviewStatus ready, workspace ]

            Compare _ _ ->
                div [] [ reviewStatus ready, workspace ]

            Commit _ _ ->
                div [] [ reviewStatus ready, workspace ]
        , case ready.kind of
            PullReview collaboration ->
                Html.map ReadyMsg (CollaborationView.reviewComposer collaborationActions collaboration)

            ChangeReview ->
                text ""
        ]


reviewHeader : ReviewLocation -> ReadyReview -> Html Msg
reviewHeader reviewLocation ready =
    let
        files =
            ready.document.files

        repository =
            Git.repositoryToString reviewLocation.repository
    in
    header [ class "review-header" ]
        [ div [ class "review-header-copy" ]
            [ div [ class "review-kicker" ]
                [ a [ href ("/" ++ repository) ] [ text repository ]
                , span [] [ text (Route.reviewLabel reviewLocation) ]
                , backingBadge ready.document
                ]
            , h1 [] [ text ready.document.title ]
            , p [] (changeSummary reviewLocation ready.document)
            ]
        , div [ class "review-summary" ]
            [ metric (String.fromInt (List.length files)) "files" ""
            , metric ("+" ++ String.fromInt (List.sum (List.map .additions files))) "added" "is-addition"
            , metric ("−" ++ String.fromInt (List.sum (List.map .deletions files))) "removed" "is-deletion"
            , case ready.reload of
                Reloading _ ->
                    button [ type_ "button", disabled True ] [ text "Refreshing…" ]

                Settled ->
                    button [ type_ "button", attribute "title" "Refresh diff from GitHub", onClick Refreshed ] [ text "Refresh" ]

                ReloadFailed _ ->
                    button [ type_ "button", attribute "title" "Refresh diff from GitHub", onClick Refreshed ] [ text "Refresh" ]
            ]
        , case ready.reload of
            ReloadFailed error ->
                div [ class "revision-notice is-error", attribute "role" "alert" ] [ text (ApiError.message error) ]

            Settled ->
                text ""

            Reloading _ ->
                text ""
        , case ready.kind of
            PullReview collaboration ->
                revisionNotice (Collaboration.revision collaboration)

            ChangeReview ->
                text ""
        ]


{-| Describes the change the way GitHub does for its subject.
-}
changeSummary : ReviewLocation -> ReviewDocument -> List (Html msg)
changeSummary reviewLocation document =
    let
        merge =
            [ text (document.author ++ " wants to merge "), code [] [ text document.head ], text " into ", code [] [ text document.base ] ]

        committed =
            [ text (document.author ++ " committed ")
            , code [] [ text (Git.shortOid document.revision.headOid) ]
            , text " on parent "
            , code [] [ text (Git.shortOid document.revision.baseOid) ]
            ]
    in
    case reviewLocation.subject of
        PullRequest _ (PullFiles _) ->
            merge

        PullRequest _ PullCommits ->
            merge

        PullRequest _ (PullCommitFiles _ _) ->
            committed

        Commit _ _ ->
            committed

        Compare _ _ ->
            [ text "Comparing ", code [] [ text document.base ], text " … ", code [] [ text document.head ] ]


{-| Review-wide failures, rendered once instead of per file. Progress is in
the toolbar.
-}
reviewStatus : ReadyReview -> Html Msg
reviewStatus ready =
    div []
        [ case Analysis.status ready.analysis of
            Analysis.AnalysisInFlight ->
                text ""

            Analysis.AnalysisFailure error ->
                div [ class "review-analysis-status is-error", attribute "role" "alert" ] [ text (ApiError.message error) ]

            Analysis.AnalysisComplete ->
                text ""

            Analysis.AnalysisDisabled ->
                text ""
        , case ready.kind of
            PullReview collaboration ->
                case Collaboration.comments collaboration of
                    Failure _ error ->
                        div [ class "review-comments-error", attribute "role" "alert" ] [ text ("Could not load GitHub review threads: " ++ ApiError.message error) ]

                    Loading _ ->
                        text ""

                    Success _ _ ->
                        text ""

                    NotAsked ->
                        text ""

            ChangeReview ->
                text ""
        ]


backingBadge : ReviewDocument -> Html Msg
backingBadge document =
    case document.source of
        LocalSource _ ->
            span [ class "backing-badge is-local" ] [ text ("local · " ++ Git.shortOid document.revision.headOid) ]

        GitHubSource ->
            span [ class "backing-badge is-github" ] [ text "GitHub" ]


metric : String -> String -> String -> Html msg
metric amount description extra =
    div [ class ("review-metric " ++ extra) ] [ strong [] [ text amount ], span [] [ text description ] ]


revisionNotice : Remote Session.Id ApiError Revision -> Html Msg
revisionNotice revision =
    case revision of
        Success _ (LocalRevision { head }) ->
            case head of
                HeadCurrent ->
                    text ""

                HeadBehind _ ->
                    div [ class "revision-notice" ]
                        [ span [] [ text "A newer revision is available." ]
                        , button [ type_ "button", onClick Refreshed ] [ text "Load latest" ]
                        ]

        Success _ GitHubRevision ->
            text ""

        Failure _ error ->
            div [ class "revision-notice is-error" ] [ text (ApiError.message error) ]

        Loading _ ->
            text ""

        NotAsked ->
            text ""


reviewToolbar : Settings -> ReviewLocation -> ReadyReview -> Html Msg
reviewToolbar settings reviewLocation ready =
    Html.map ReadyMsg
        (ToolbarView.view
            { settings = settings
            , pullTabs =
                case reviewLocation.subject of
                    PullRequest _ pullView ->
                        Just
                            { filesActive = pullView /= PullCommits
                            , selectFiles = SelectedPullView (PullFiles Nothing)
                            , selectCommits = SelectedPullView PullCommits
                            }

                    Compare _ _ ->
                        Nothing

                    Commit _ _ ->
                        Nothing
            , filter = DiffView.filterText ready.diff
            , searchMode = DiffView.searchMode ready.diff
            , changeFilter = ChangedFilter
            , selectSearchMode = SelectedSearchMode
            , changeSetting = ChangedSetting
            , optionsOpen = DiffView.optionsOpen ready.diff
            , toggleOptions = ToggledDiffOptions
            , closeOptions = ClosedDiffOptions
            , progress =
                case Analysis.status ready.analysis of
                    Analysis.AnalysisInFlight ->
                        Just "Analyzing syntax trees…"

                    Analysis.AnalysisFailure _ ->
                        Nothing

                    Analysis.AnalysisComplete ->
                        Nothing

                    Analysis.AnalysisDisabled ->
                        Nothing
            }
        )


reviewWorkspace : Settings -> ReviewLocation -> ReadyReview -> Html Msg
reviewWorkspace settings reviewLocation ready =
    let
        visible =
            visibleFiles settings reviewLocation ready

        collapsed =
            settings.sidebar == Collapsed
    in
    div [ classList [ ( "workspace", True ), ( "sidebar-collapsed", collapsed ) ] ]
        [ aside [ class "file-sidebar", attribute "data-viewport-scroll-region" "" ]
            [ button
                [ type_ "button"
                , class "sidebar-toggle"
                , attribute "title"
                    (if collapsed then
                        "Expand file sidebar"

                     else
                        "Collapse file sidebar"
                    )
                , onClick
                    (ReadyMsg
                        (ChangedSetting
                            (Settings.SetSidebar
                                (if collapsed then
                                    Expanded

                                 else
                                    Collapsed
                                )
                            )
                        )
                    )
                ]
                [ text
                    (if collapsed then
                        "›"

                     else
                        "‹"
                    )
                ]
            , if collapsed then
                text ""

              else
                div [ class "file-sidebar-content" ]
                    [ header [] [ strong [] [ text "Changed files" ], span [ class "count-badge" ] [ text (String.fromInt (List.length ready.document.files)) ] ]
                    , div [ class "file-sidebar-tree" ] [ Html.map ReadyMsg (reviewFileTree reviewLocation ready) ]
                    ]
            ]
        , Keyed.node "section"
            [ classList
                [ ( "review-diffs", True )
                , ( "full-diff", settings.reviewScope == FullDiff )
                , ( "diff-colors-disabled", settings.diffColors == Disabled )
                ]
            ]
            (case visible of
                [] ->
                    [ ( "empty", div [ class "empty-diff" ] [ h1 [] [ text "No matching files" ], p [] [ text "Change or clear the review search." ] ] ) ]

                _ ->
                    List.map (\file -> ( (FileIndex.change file).path, Html.map ReadyMsg (renderFileDiff settings reviewLocation ready file) )) visible
            )
        ]


visibleFiles : Settings -> ReviewLocation -> ReadyReview -> List FileIndex.File
visibleFiles settings reviewLocation ready =
    let
        searched =
            Analysis.files ready.analysis
                |> FileIndex.files
                |> List.filter (FileIndex.prepared >> DiffView.matches (DiffView.filter ready.diff))
    in
    case settings.reviewScope of
        FullDiff ->
            searched

        OneFile ->
            case Route.selectedPath reviewLocation of
                Just selected ->
                    List.filter (FileIndex.change >> .path >> (==) selected) searched

                Nothing ->
                    List.take 1 searched


renderFileDiff : Settings -> ReviewLocation -> ReadyReview -> FileIndex.File -> Html ReadyMsg
renderFileDiff settings reviewLocation ready file =
    let
        path =
            (FileIndex.change file).path
    in
    Lazy.lazy7 DiffPanelView.view
        diffPanelActions
        (DiffPanelView.layout settings.viewMode (isPullReview ready))
        (DiffPanelView.lineOptions settings.whitespace settings.syntaxHighlighting)
        (Route.blobUrl reviewLocation.repository ready.document.revision.headOid path)
        file
        (DiffView.fileState path ready.diff)
        (case ready.kind of
            PullReview collaboration ->
                Collaboration.fileState path collaboration

            ChangeReview ->
                Collaboration.noFileState
        )


isPullReview : ReadyReview -> Bool
isPullReview ready =
    case ready.kind of
        PullReview _ ->
            True

        ChangeReview ->
            False


reviewFileTree : ReviewLocation -> ReadyReview -> Html ReadyMsg
reviewFileTree reviewLocation ready =
    FileTreeView.view
        { selectedPath = Route.selectedPath reviewLocation
        , isReviewed = \path -> DiffView.fileIsReviewed (DiffView.fileState path ready.diff)
        , isCollapsed = \path -> DiffView.isFolderCollapsed path ready.diff
        , toggleFolder = ToggledFolder
        , selectFile = SelectedFile
        }
        ready.tree


commitsView : ReadyReview -> Html Msg
commitsView ready =
    section [ class "commits-view" ]
        [ case ready.kind of
            PullReview collaboration ->
                case Collaboration.commits collaboration of
                    Loading _ ->
                        pageState "Loading commits…"

                    Failure _ error ->
                        div [ class "page-state is-error" ] [ text (ApiError.message error) ]

                    Success _ commits ->
                        div [ class "commit-list" ] (List.map commitRow commits)

                    NotAsked ->
                        pageState "Loading commits…"

            ChangeReview ->
                text ""
        ]


commitRow : PullCommit -> Html Msg
commitRow commit =
    button [ type_ "button", class "commit-row", onClick (ReadyMsg (SelectedPullView (PullCommitFiles (Git.oidToString commit.sha) Nothing))) ]
        [ case commit.avatarUrl of
            Just avatar ->
                Html.img [ class "commit-avatar", Html.Attributes.src avatar ] []

            Nothing ->
                text ""
        , div []
            [ strong [] [ text commit.message ]
            , span []
                (case commit.authoredAt of
                    Just authoredAt ->
                        [ text (commit.author ++ " · "), TimeView.view authoredAt ]

                    Nothing ->
                        [ text commit.author ]
                )
            ]
        , code [] [ text (Git.shortOid commit.sha) ]
        ]


collaborationActions : CollaborationView.Actions ReadyMsg
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


diffPanelActions : DiffPanelView.Actions ReadyMsg
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


pageState : String -> Html msg
pageState message =
    div [ class "page-state" ] [ span [ class "loading-spinner" ] [], text message ]
