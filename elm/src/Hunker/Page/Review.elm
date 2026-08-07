module Hunker.Page.Review exposing
    ( Model
    , Msg(..)
    , init
    , location
    , navigate
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
import Hunker.Diff as Diff exposing (DiffLine, Hunk, Kind(..), SideLine, SplitRow)
import Hunker.Domain.Review as Review exposing (AnalysisSnapshot, CharacterRange, FileChange, FileStatus(..), FullFile, MovedBlock, PullCommit, ReviewComment, ReviewDocument, Revision, SemanticChange(..), SemanticResult(..))
import Hunker.Domain.Settings as Settings exposing (InlineDiffMode(..), ReviewScope(..), Settings, ViewMode(..))
import Hunker.Effect as Effect exposing (Effect)
import Hunker.FileTree as FileTree exposing (Tree(..))
import Hunker.PreparedDiff as PreparedDiff exposing (PreparedFile)
import Hunker.Remote as Remote exposing (Remote(..))
import Hunker.Route as Route exposing (ReviewTab(..), ReviewTarget(..))
import Hunker.SemanticMove as SemanticMove exposing (Endpoint(..))
import Hunker.Syntax as Syntax
import Markdown
import Regex
import Set exposing (Set)
import Time
import Url


type alias Model =
    { location : Route.ReviewLocation
    , requestUrl : String
    , pullUrl : String
    , review : Remote String String ReviewDocument
    , files : List FileChange
    , preparedFiles : Dict String PreparedFile
    , pullRequestFiles : List FileChange
    , commits : Remote String String (List PullCommit)
    , analysis : Remote AnalysisIdentity String AnalysisSnapshot
    , fullFiles : Dict String (Remote String String FullFile)
    , comments : Remote String String (List ReviewComment)
    , revision : Remote String String Revision
    , settings : Settings
    , filter : String
    , filterMode : SearchMode
    , collapsedFolders : Set String
    , collapsedFiles : Set String
    , collapsedHunks : Set String
    , reviewedFiles : Set String
    , collapsedThreads : Set Int
    , replyDrafts : Dict Int String
    , replyState : Remote Int String ReviewComment
    , reviewBody : String
    , reviewSubmission : Remote String String String
    , inlineComposer : Maybe InlineComposer
    , inlineSubmission : Remote String String ReviewComment
    }


type SearchMode
    = Literal
    | Regex


type alias AnalysisIdentity =
    { requestUrl : String
    , baseOid : String
    , headOid : String
    , ignoreWhitespace : Bool
    , semantic : Bool
    , inlineDiff : String
    }


type alias InlineComposer =
    { path : String
    , line : Int
    , side : String
    , body : String
    }


type Msg
    = ReviewLoaded String ReviewDocument
    | ReviewFailed String String
    | Refreshed
    | CommitsLoaded String (List PullCommit)
    | CommitsFailed String String
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
    | SettingsSaved
    | SettingsSaveFailed String
    | AnalysisLoaded AnalysisIdentity AnalysisSnapshot
    | AnalysisFailed AnalysisIdentity String
    | FullFileLoaded String String FullFile
    | FullFileFailed String String String
    | ToggledFullFile FileChange
    | ToggledFile String
    | ToggledHunk String String
    | ToggledReviewed String
    | SelectedMoveTarget String String
    | CommentsLoaded String (List ReviewComment)
    | CommentsFailed String String
    | ToggledThread Int
    | ChangedReply Int String
    | SubmittedReply Int
    | ReplyLoaded Int ReviewComment
    | ReplyFailed Int String
    | ChangedReviewBody String
    | SubmittedReview String
    | ReviewSubmitted String String
    | ReviewSubmitFailed String String
    | OpenedInlineComposer String Int String
    | ChangedInlineBody String
    | CancelledInlineComposer
    | SubmittedInlineComment
    | InlineCommentLoaded String ReviewComment
    | InlineCommentFailed String String
    | CheckedRevision
    | RevisionLoaded String Revision
    | RevisionFailed String String
    | PollRevision Time.Posix


init : Settings -> Route.ReviewLocation -> ( Model, Effect Msg )
init settings reviewLocation =
    let
        pullUrl =
            Route.githubUrl reviewLocation.target

        githubUrl =
            case ( reviewLocation.target, reviewLocation.commit ) of
                ( PullRequest owner repository _, Just sha ) ->
                    "https://github.com/" ++ owner ++ "/" ++ repository ++ "/commit/" ++ sha

                _ ->
                    pullUrl

        model =
            { location = reviewLocation
            , requestUrl = githubUrl
            , pullUrl = pullUrl
            , review = Loading githubUrl
            , files = []
            , preparedFiles = Dict.empty
            , pullRequestFiles = []
            , commits = NotAsked
            , analysis = NotAsked
            , fullFiles = Dict.empty
            , comments = NotAsked
            , revision = NotAsked
            , settings = settings
            , filter = ""
            , filterMode = Literal
            , collapsedFolders = Set.empty
            , collapsedFiles = Set.empty
            , collapsedHunks = Set.empty
            , reviewedFiles = Set.empty
            , collapsedThreads = Set.empty
            , replyDrafts = Dict.empty
            , replyState = NotAsked
            , reviewBody = ""
            , reviewSubmission = NotAsked
            , inlineComposer = Nothing
            , inlineSubmission = NotAsked
            }
    in
    ( model, Api.fetchReview githubUrl (ReviewLoaded githubUrl) (ReviewFailed githubUrl) )


location : Model -> Route.ReviewLocation
location =
    .location


navigate : Route.ReviewLocation -> Model -> ( Model, Effect Msg )
navigate nextLocation model =
    let
        sameRevision =
            nextLocation.target
                == model.location.target
                && nextLocation.commit
                == model.location.commit

        updated =
            { model | location = nextLocation }
    in
    if not sameRevision then
        init model.settings nextLocation

    else if nextLocation.path == model.location.path then
        ( updated, Effect.none )

    else
        ( updated, Effect.none )


title : Model -> String
title model =
    case model.review of
        Loading _ ->
            "Loading review · Hunker"

        Success _ reviewData ->
            reviewData.title ++ " · Hunker"

        Failure _ _ ->
            "Could not load review · Hunker"

        NotAsked ->
            "Hunker"


subscriptions : Model -> Sub Msg
subscriptions model =
    case model.location.target of
        PullRequest _ _ _ ->
            Time.every 120000 PollRevision

        _ ->
            Sub.none


update : Msg -> Model -> ( Model, Effect Msg )
update msg model =
    case msg of
        ReviewLoaded requested reviewData ->
            if requested /= model.requestUrl then
                unchanged model

            else
                reviewReady reviewData model

        ReviewFailed requested error ->
            if requested == model.requestUrl then
                ( { model | review = Failure requested error, files = [], preparedFiles = Dict.empty, pullRequestFiles = [] }, Effect.none )

            else
                unchanged model

        Refreshed ->
            ( { model
                | review = Loading model.requestUrl
                , files = []
                , preparedFiles = Dict.empty
                , analysis = NotAsked
                , fullFiles = Dict.empty
                , comments = NotAsked
              }
            , Api.fetchReview model.requestUrl (ReviewLoaded model.requestUrl) (ReviewFailed model.requestUrl)
            )

        CommitsLoaded requested commits ->
            if requested == model.pullUrl then
                ( { model | commits = Success requested commits }, Effect.none )

            else
                unchanged model

        CommitsFailed requested error ->
            if requested == model.pullUrl then
                ( { model | commits = Failure requested error }, Effect.none )

            else
                unchanged model

        SelectedTab tab ->
            let
                current =
                    model.location

                next =
                    { current | tab = tab, commit = Nothing, path = Nothing }
            in
            ( model, Effect.PushUrl (Route.toPath (Route.Review next)) )

        SelectedCommit sha ->
            let
                current =
                    model.location

                next =
                    { current | tab = ReviewCommits, commit = Just sha, path = Nothing }
            in
            ( model, Effect.PushUrl (Route.toPath (Route.Review next)) )

        SelectedFile path ->
            let
                current =
                    model.location

                next =
                    { current | tab = ReviewFiles, path = Just path, commit = Nothing }
            in
            ( model, Effect.PushUrl (Route.toPath (Route.Review next)) )

        ChangedFilter filter ->
            ( { model | filter = filter }, Effect.none )

        SelectedSearchMode mode ->
            ( { model | filterMode = mode }, Effect.none )

        ToggledFolder path ->
            ( { model | collapsedFolders = toggleSet path model.collapsedFolders }, Effect.none )

        ToggledSidebar ->
            saveSettings { model | settings = mapSettings (\settings -> { settings | sidebarCollapsed = not settings.sidebarCollapsed }) model }

        SelectedScope scope ->
            let
                updated =
                    { model | settings = mapSettings (\settings -> { settings | reviewScope = scope }) model }
            in
            saveSettings updated

        SelectedViewMode mode ->
            saveSettings { model | settings = mapSettings (\settings -> { settings | viewMode = mode }) model }

        ToggledWhitespace value ->
            let
                updated =
                    { model | settings = mapSettings (\settings -> { settings | ignoreWhitespace = value }) model }
            in
            beginAnalysisAndSave updated

        ToggledSemantic value ->
            let
                updated =
                    { model | settings = mapSettings (\settings -> { settings | semantic = value }) model }
            in
            beginAnalysisAndSave updated

        SelectedInlineMode mode ->
            let
                updated =
                    { model | settings = mapSettings (\settings -> { settings | inlineDiffMode = mode }) model }
            in
            beginAnalysisAndSave updated

        ToggledSyntax value ->
            saveSettings { model | settings = mapSettings (\settings -> { settings | syntaxHighlighting = value }) model }

        ToggledReviews value ->
            let
                updated =
                    { model | settings = mapSettings (\settings -> { settings | showGitHubReviews = value }) model }

                effect =
                    if value then
                        commentsEffect updated

                    else
                        Effect.none
            in
            saveSettingsWith effect updated

        SettingsSaved ->
            unchanged model

        SettingsSaveFailed error ->
            ( { model | reviewSubmission = Failure "settings" error }, Effect.none )

        AnalysisLoaded requested snapshot ->
            if Just requested == Remote.identity model.analysis then
                ( { model
                    | analysis = Success requested snapshot
                    , preparedFiles = applyAnalysis snapshot model.preparedFiles
                  }
                , Effect.none
                )

            else
                unchanged model

        AnalysisFailed requested error ->
            if Just requested == Remote.identity model.analysis then
                ( { model | analysis = Failure requested error }, Effect.none )

            else
                unchanged model

        FullFileLoaded requested path fullFile ->
            if requested == model.requestUrl then
                ( { model | fullFiles = Dict.insert path (Success requested fullFile) model.fullFiles }, Effect.none )

            else
                unchanged model

        FullFileFailed requested path error ->
            if requested == model.requestUrl then
                ( { model | fullFiles = Dict.insert path (Failure requested error) model.fullFiles }, Effect.none )

            else
                unchanged model

        ToggledFullFile file ->
            case Dict.get file.path model.fullFiles of
                Just (Success _ _) ->
                    ( { model | fullFiles = Dict.remove file.path model.fullFiles }, Effect.none )

                Just (Loading _) ->
                    unchanged model

                _ ->
                    case readyReview model of
                        Nothing ->
                            unchanged model

                        Just reviewData ->
                            ( { model | fullFiles = Dict.insert file.path (Loading model.requestUrl) model.fullFiles }
                            , Api.fetchFullFile model.requestUrl file reviewData.backing (FullFileLoaded model.requestUrl file.path) (FullFileFailed model.requestUrl file.path)
                            )

        ToggledFile path ->
            ( { model | collapsedFiles = toggleSet path model.collapsedFiles }, Effect.none )

        ToggledHunk path hunkId ->
            ( { model | collapsedHunks = toggleSet (path ++ ":" ++ hunkId) model.collapsedHunks }, Effect.none )

        ToggledReviewed path ->
            let
                reviewed =
                    Set.member path model.reviewedFiles
            in
            ( { model
                | reviewedFiles = toggleSet path model.reviewedFiles
                , collapsedFiles =
                    if reviewed then
                        Set.remove path model.collapsedFiles

                    else
                        Set.insert path model.collapsedFiles
              }
            , Effect.none
            )

        SelectedMoveTarget path anchor ->
            let
                current =
                    model.location

                currentSettings =
                    model.settings

                next =
                    { current | path = Just path, tab = ReviewFiles }

                navigation =
                    if model.location.path == Just path then
                        Effect.none

                    else
                        Effect.ReplaceUrl (Route.toPath (Route.Review next))
            in
            ( { model | location = next, settings = { currentSettings | reviewScope = OneFile }, collapsedFiles = Set.remove path model.collapsedFiles }
            , Effect.batch [ navigation, Effect.Focus anchor CheckedRevision ]
            )

        CommentsLoaded requested comments ->
            if requested == model.pullUrl then
                let
                    resolvedRoots =
                        comments
                            |> List.filter (\comment -> comment.id == comment.rootId && comment.resolved)
                            |> List.map .rootId
                            |> Set.fromList
                in
                ( { model | comments = Success requested comments, collapsedThreads = Set.union model.collapsedThreads resolvedRoots }, Effect.none )

            else
                unchanged model

        CommentsFailed requested error ->
            if requested == model.pullUrl then
                ( { model | comments = Failure requested error }, Effect.none )

            else
                unchanged model

        ToggledThread threadId ->
            ( { model | collapsedThreads = toggleSet threadId model.collapsedThreads }, Effect.none )

        ChangedReply commentId body ->
            ( { model | replyDrafts = Dict.insert commentId body model.replyDrafts, replyState = NotAsked }, Effect.none )

        SubmittedReply commentId ->
            let
                body =
                    Dict.get commentId model.replyDrafts |> Maybe.withDefault ""
            in
            if String.trim body == "" then
                unchanged model

            else
                ( { model | replyState = Loading commentId }
                , Api.postReply model.pullUrl commentId body (ReplyLoaded commentId) (ReplyFailed commentId)
                )

        ReplyLoaded commentId comment ->
            ( { model
                | comments = mapSuccess (\comments -> comments ++ [ comment ]) model.comments
                , replyDrafts = Dict.remove commentId model.replyDrafts
                , replyState = Success commentId comment
              }
            , Effect.none
            )

        ReplyFailed commentId error ->
            ( { model | replyState = Failure commentId error }, Effect.none )

        ChangedReviewBody body ->
            ( { model | reviewBody = body, reviewSubmission = NotAsked }, Effect.none )

        SubmittedReview event ->
            ( { model | reviewSubmission = Loading event }
            , Api.submitReview model.pullUrl model.reviewBody event (ReviewSubmitted event) (ReviewSubmitFailed event)
            )

        ReviewSubmitted event response ->
            ( { model | reviewSubmission = Success event response, reviewBody = "" }, Effect.none )

        ReviewSubmitFailed event error ->
            ( { model | reviewSubmission = Failure event error }, Effect.none )

        OpenedInlineComposer path line side ->
            ( { model | inlineComposer = Just { path = path, line = line, side = side, body = "" }, inlineSubmission = NotAsked }, Effect.none )

        ChangedInlineBody body ->
            ( { model | inlineComposer = Maybe.map (\composer -> { composer | body = body }) model.inlineComposer }, Effect.none )

        CancelledInlineComposer ->
            ( { model | inlineComposer = Nothing, inlineSubmission = NotAsked }, Effect.none )

        SubmittedInlineComment ->
            case ( readyReview model, model.inlineComposer ) of
                ( Just reviewData, Just composer ) ->
                    if String.trim composer.body == "" then
                        unchanged model

                    else
                        ( { model | inlineSubmission = Loading composer.path }
                        , Api.postInlineComment
                            { pullUrl = model.pullUrl
                            , commitId = Review.backingHeadOid reviewData.backing
                            , path = composer.path
                            , line = composer.line
                            , side = composer.side
                            , body = composer.body
                            }
                            (InlineCommentLoaded composer.path)
                            (InlineCommentFailed composer.path)
                        )

                _ ->
                    unchanged model

        InlineCommentLoaded path comment ->
            ( { model
                | comments = mapSuccess (\comments -> comments ++ [ comment ]) model.comments
                , inlineComposer = Nothing
                , inlineSubmission = Success path comment
              }
            , Effect.none
            )

        InlineCommentFailed path error ->
            ( { model | inlineSubmission = Failure path error }, Effect.none )

        CheckedRevision ->
            revisionCheck model

        RevisionLoaded requested revision ->
            if requested == model.requestUrl then
                ( { model | revision = Success requested revision }, Effect.none )

            else
                unchanged model

        RevisionFailed requested error ->
            if requested == model.requestUrl then
                ( { model | revision = Failure requested error }, Effect.none )

            else
                unchanged model

        PollRevision _ ->
            revisionCheck model


reviewReady : ReviewDocument -> Model -> ( Model, Effect Msg )
reviewReady reviewData model =
    let
        currentLocation =
            model.location

        files =
            reviewData.files

        selected =
            case model.location.path |> Maybe.andThen (\path -> List.filter (.path >> (==) path) files |> List.head) of
                Just file ->
                    Just file

                Nothing ->
                    List.head files

        selectedPath =
            Maybe.map .path selected

        updatedLocation =
            { currentLocation | path = selectedPath }

        updated =
            { model
                | review = Success model.requestUrl reviewData
                , files = files
                , preparedFiles =
                    files
                        |> List.map (\file -> ( file.path, PreparedDiff.prepare file ))
                        |> Dict.fromList
                , pullRequestFiles = files
                , location = updatedLocation
                , commits =
                    if Route.isPullRequest model.location.target then
                        Loading model.pullUrl

                    else
                        NotAsked
            }

        canonical =
            if model.location.path == selectedPath || model.location.tab == ReviewCommits then
                Effect.none

            else
                Effect.ReplaceUrl (Route.toPath (Route.Review updatedLocation))

        commitsEffect =
            if Route.isPullRequest model.location.target then
                Api.fetchCommits model.pullUrl (CommitsLoaded model.pullUrl) (CommitsFailed model.pullUrl)

            else
                Effect.none
    in
    let
        ( analyzing, analysisEffect ) =
            beginAnalysis updated
    in
    ( analyzing
    , Effect.batch
        [ canonical
        , commitsEffect
        , analysisEffect
        , commentsEffect analyzing
        , revisionEffect analyzing
        ]
    )


beginAnalysis : Model -> ( Model, Effect Msg )
beginAnalysis model =
    case readyReview model of
        Nothing ->
            ( model, Effect.none )

        Just reviewData ->
            if not model.settings.semantic && model.settings.inlineDiffMode == InlineOff then
                ( { model
                    | analysis = NotAsked
                    , preparedFiles = Dict.map (\_ prepared -> PreparedDiff.clearWordRanges prepared) model.preparedFiles
                  }
                , Effect.none
                )

            else
                let
                    identity =
                        analysisIdentity model reviewData

                    cleared =
                        Dict.map (\_ prepared -> PreparedDiff.clearWordRanges prepared) model.preparedFiles
                in
                ( { model | analysis = Loading identity, preparedFiles = cleared }
                , Api.fetchAnalysis model.requestUrl
                    reviewData.backing
                    model.settings.ignoreWhitespace
                    model.settings.semantic
                    identity.inlineDiff
                    (AnalysisLoaded identity)
                    (AnalysisFailed identity)
                )


beginAnalysisAndSave : Model -> ( Model, Effect Msg )
beginAnalysisAndSave model =
    let
        ( updated, effect ) =
            beginAnalysis model
    in
    saveSettingsWith effect updated


analysisIdentity : Model -> ReviewDocument -> AnalysisIdentity
analysisIdentity model reviewData =
    { requestUrl = model.requestUrl
    , baseOid = Review.backingBaseOid reviewData.backing
    , headOid = Review.backingHeadOid reviewData.backing
    , ignoreWhitespace = model.settings.ignoreWhitespace
    , semantic = model.settings.semantic
    , inlineDiff = Settings.inlineDiffModeToString model.settings.inlineDiffMode
    }


applyAnalysis : AnalysisSnapshot -> Dict String PreparedFile -> Dict String PreparedFile
applyAnalysis snapshot preparedFiles =
    Dict.foldl
        (\_ file prepared ->
            case ( Dict.get file.path prepared, file.wordDiff ) of
                ( Just existing, Just wordDiff ) ->
                    Dict.insert file.path (PreparedDiff.withWordDiff wordDiff existing) prepared

                _ ->
                    prepared
        )
        preparedFiles
        snapshot.files


commentsEffect : Model -> Effect Msg
commentsEffect model =
    if model.settings.showGitHubReviews && Route.isPullRequest model.location.target && model.location.commit == Nothing then
        Api.fetchReviewComments model.pullUrl (CommentsLoaded model.pullUrl) (CommentsFailed model.pullUrl)

    else
        Effect.none


revisionEffect : Model -> Effect Msg
revisionEffect model =
    case ( model.location.target, readyReview model ) of
        ( PullRequest _ _ _, Just reviewData ) ->
            Api.checkRevision model.requestUrl (Review.backingHeadOid reviewData.backing) (RevisionLoaded model.requestUrl) (RevisionFailed model.requestUrl)

        _ ->
            Effect.none


revisionCheck : Model -> ( Model, Effect Msg )
revisionCheck model =
    case ( model.location.target, readyReview model ) of
        ( PullRequest _ _ _, Just _ ) ->
            ( { model | revision = Loading model.requestUrl }, revisionEffect model )

        _ ->
            unchanged model


saveSettings : Model -> ( Model, Effect Msg )
saveSettings =
    saveSettingsWith Effect.none


saveSettingsWith : Effect Msg -> Model -> ( Model, Effect Msg )
saveSettingsWith additional model =
    ( model
    , Effect.batch
        [ additional
        , Api.saveSettings model.settings (always SettingsSaved) SettingsSaveFailed
        ]
    )


mapSettings : (Settings -> Settings) -> Model -> Settings
mapSettings transform model =
    transform model.settings


readyReview : Model -> Maybe ReviewDocument
readyReview model =
    case model.review of
        Success requested reviewData ->
            if requested == model.requestUrl then
                Just reviewData

            else
                Nothing

        _ ->
            Nothing


visibleFiles : Model -> List FileChange
visibleFiles model =
    let
        searched =
            List.filter (matchesFilter model) model.files
    in
    case model.settings.reviewScope of
        FullDiff ->
            searched

        OneFile ->
            case model.location.path of
                Just selected ->
                    List.filter (.path >> (==) selected) searched

                Nothing ->
                    List.take 1 searched


matchesFilter : Model -> FileChange -> Bool
matchesFilter model file =
    let
        query =
            String.toLower (String.trim model.filter)

        haystack =
            String.toLower (file.path ++ "\n" ++ file.patch)
    in
    if query == "" then
        True

    else
        case model.filterMode of
            Literal ->
                String.contains query haystack

            Regex ->
                -- Invalid regular expressions intentionally match nothing; the
                -- search control remains a pure view of this typed branch.
                Regex.fromString model.filter
                    |> Maybe.map (\expression -> Regex.contains expression (file.path ++ "\n" ++ file.patch))
                    |> Maybe.withDefault False


view : Model -> Html Msg
view model =
    case model.review of
        Loading url ->
            loadingView url

        Failure _ error ->
            section [ class "review-load-error", attribute "role" "alert" ]
                [ strong [] [ text "Could not load this change" ]
                , p [] [ text error ]
                , button [ type_ "button", onClick Refreshed ] [ text "Try again" ]
                ]

        Success requested reviewData ->
            if requested /= model.requestUrl then
                loadingView model.requestUrl

            else
                readyView model reviewData

        NotAsked ->
            loadingView model.requestUrl


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


readyView : Model -> ReviewDocument -> Html Msg
readyView model reviewData =
    main_ [ class "review-page review-grid" ]
        [ reviewHeader model reviewData
        , reviewToolbar model
        , case model.location.tab of
            ReviewCommits ->
                case model.location.commit of
                    Just sha ->
                        div [ class "commit-diff-view" ]
                            [ div [ class "commit-detail" ]
                                [ button [ type_ "button", onClick (SelectedTab ReviewCommits) ] [ text "← All commits" ]
                                , h1 [] [ text ("Commit " ++ String.left 12 sha) ]
                                ]
                            , reviewWorkspace model
                            ]

                    Nothing ->
                        commitsView model

            ReviewFiles ->
                reviewWorkspace model
        , if Route.isPullRequest model.location.target && model.location.commit == Nothing then
            reviewComposer model

          else
            text ""
        ]


reviewHeader : Model -> ReviewDocument -> Html Msg
reviewHeader model reviewData =
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
            [ metric (String.fromInt (List.length model.files)) "files" ""
            , metric ("+" ++ String.fromInt (List.sum (List.map .additions model.files))) "added" "is-addition"
            , metric ("−" ++ String.fromInt (List.sum (List.map .deletions model.files))) "removed" "is-deletion"
            , button [ type_ "button", attribute "title" "Refresh diff from GitHub", onClick Refreshed ] [ text "Refresh" ]
            ]
        , revisionNotice model.revision
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


revisionNotice : Remote String String Revision -> Html Msg
revisionNotice revision =
    case revision of
        Success _ value ->
            if value.current then
                text ""

            else
                div [ class "revision-notice" ]
                    [ span [] [ text "A newer revision is available." ]
                    , button [ type_ "button", onClick Refreshed ] [ text "Load latest" ]
                    ]

        Failure _ error ->
            div [ class "revision-notice is-error" ] [ text error ]

        _ ->
            text ""


reviewToolbar : Model -> Html Msg
reviewToolbar model =
    section
        [ class "compact-review-toolbar" ]
        [ div [ class "review-tab-picker" ]
            [ segment (model.location.tab == ReviewFiles) (SelectedTab ReviewFiles) "Files"
            , if Route.isPullRequest model.location.target then
                segment (model.location.tab == ReviewCommits) (SelectedTab ReviewCommits) "Commits"

              else
                text ""
            ]
        , label [ class "review-search" ]
            [ span [] [ text "⌕" ]
            , select [ onInput (searchModeFromString >> SelectedSearchMode) ]
                [ option [ value "literal", selected (model.filterMode == Literal) ] [ text "Text" ]
                , option [ value "regex", selected (model.filterMode == Regex) ] [ text "Regex" ]
                ]
            , input [ type_ "search", attribute "aria-label" "Search this change", placeholder "Search this change", value model.filter, onInput ChangedFilter ] []
            ]
        , div [ class "diff-options" ]
            [ select [ attribute "aria-label" "Diff scope", onInput (scopeFromString >> SelectedScope) ]
                [ option [ value "file", selected (model.settings.reviewScope == OneFile) ] [ text "One file" ]
                , option [ value "full", selected (model.settings.reviewScope == FullDiff) ] [ text "Full diff" ]
                ]
            , select [ attribute "aria-label" "Diff layout", onInput (viewModeFromString >> SelectedViewMode) ]
                [ option [ value "split", selected (model.settings.viewMode == Split) ] [ text "Side by side" ]
                , option [ value "unified", selected (model.settings.viewMode == Unified) ] [ text "Unified" ]
                ]
            , toggle "Ignore whitespace" model.settings.ignoreWhitespace ToggledWhitespace
            , toggle "Semantic" model.settings.semantic ToggledSemantic
            , select [ attribute "aria-label" "Inline diff", onInput (Settings.inlineDiffModeFromString >> SelectedInlineMode) ]
                [ option [ value "token", selected (model.settings.inlineDiffMode == Token) ] [ text "Word diff" ]
                , option [ value "character", selected (model.settings.inlineDiffMode == Character) ] [ text "Character diff" ]
                , option [ value "off", selected (model.settings.inlineDiffMode == InlineOff) ] [ text "Inline off" ]
                ]
            , toggle "Syntax" model.settings.syntaxHighlighting ToggledSyntax
            , if Route.isPullRequest model.location.target then
                toggle "GitHub reviews" model.settings.showGitHubReviews ToggledReviews

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


reviewWorkspace : Model -> Html Msg
reviewWorkspace model =
    div
        [ class
            ("workspace"
                ++ (if model.settings.sidebarCollapsed then
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
                    (if model.settings.sidebarCollapsed then
                        "Expand file sidebar"

                     else
                        "Collapse file sidebar"
                    )
                , onClick ToggledSidebar
                ]
                [ text
                    (if model.settings.sidebarCollapsed then
                        "›"

                     else
                        "‹"
                    )
                ]
            , if model.settings.sidebarCollapsed then
                text ""

              else
                div []
                    [ header [] [ strong [] [ text "Changed files" ], span [ class "count-badge" ] [ text (String.fromInt (List.length model.files)) ] ]
                    , reviewFileTree model (FileTree.build .path model.files)
                    ]
            ]
        , section
            [ class
                ("review-diffs"
                    ++ (if model.settings.reviewScope == FullDiff then
                            " full-diff"

                        else
                            ""
                       )
                )
            ]
            (if List.isEmpty (visibleFiles model) then
                [ div [ class "empty-diff" ] [ h1 [] [ text "No matching files" ], p [] [ text "Change or clear the review search." ] ] ]

             else
                List.map (fileDiff model) (visibleFiles model)
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
                    Set.member path model.collapsedFolders
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
                    Maybe.withDefault "" model.location.path

                reviewed =
                    Set.member file.path model.reviewedFiles
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


fileDiff : Model -> FileChange -> Html Msg
fileDiff model file =
    let
        collapsed =
            Set.member file.path model.collapsedFiles

        fullFile =
            Dict.get file.path model.fullFiles
    in
    article [ class ("diff-panel" ++ activeClass (Set.member file.path model.reviewedFiles)), id (fileAnchor file.path) ]
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
                        (if Set.member file.path model.reviewedFiles then
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
                [ semanticSummary model file
                , case fullFile of
                    Just (Success _ full) ->
                        fullFileDiff model file full

                    Just (Failure _ error) ->
                        div [ class "diff-error" ] [ text error ]

                    _ ->
                        patchDiff model file
                , detachedThreads model file.path
                , inlineComposerFor model file.path
                , footer [ class "diff-footer" ]
                    [ span [] [ text "End of patch" ]
                    , if Route.isPullRequest model.location.target then
                        button [ type_ "button", onClick (OpenedInlineComposer file.path (lastNewLine model file.path) "RIGHT") ] [ text "+ Add a review comment" ]

                      else
                        text ""
                    ]
                ]
        ]


semanticSummary : Model -> FileChange -> Html Msg
semanticSummary model file =
    if not model.settings.semantic then
        text ""

    else
        case model.analysis of
            Loading _ ->
                div [ class "semantic-banner is-loading" ] [ span [ class "loading-spinner" ] [], text "Analyzing syntax tree…" ]

            Failure _ error ->
                div [ class "semantic-banner is-error" ] [ text error ]

            Success _ snapshot ->
                snapshot.files
                    |> Dict.get file.path
                    |> Maybe.andThen .semantic
                    |> Maybe.map semanticResultView
                    |> Maybe.withDefault (text "")

            NotAsked ->
                text ""


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


patchDiff : Model -> FileChange -> Html Msg
patchDiff model file =
    div
        [ class
            (if model.settings.viewMode == Split then
                "split-diff"

             else
                "unified-diff"
            )
        ]
        (List.map (hunkView model file) (preparedHunks model file.path))


hunkView : Model -> FileChange -> Hunk -> Html Msg
hunkView model file hunk =
    let
        key =
            file.path ++ ":" ++ hunk.id

        collapsed =
            Set.member key model.collapsedHunks
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

          else if model.settings.viewMode == Split then
            div [ class "split-lines" ] (List.map (splitRowView model file) (Diff.splitRows model.settings.ignoreWhitespace hunk))

          else
            div [ class "unified-lines" ] (hunk.lines |> List.filter (keepLine model.settings.ignoreWhitespace) |> List.map (unifiedLineView model file))
        ]


keepLine : Bool -> DiffLine -> Bool
keepLine _ _ =
    True


splitRowView : Model -> FileChange -> SplitRow -> Html Msg
splitRowView model file row =
    div [ class "split-row" ]
        [ splitCell model file "LEFT" "left" row.left
        , splitCell model file "RIGHT" "right" row.right
        ]


splitCell : Model -> FileChange -> String -> String -> Maybe SideLine -> Html Msg
splitCell model file side sideClass maybeLine =
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
                , code [ class "line-code" ] (highlightedLine model file.path side number line.text)
                , decoration.button
                , lineThreads model file.path side number
                ]


unifiedLineView : Model -> FileChange -> DiffLine -> Html Msg
unifiedLineView model file line =
    let
        side =
            if line.kind == Deletion then
                "LEFT"

            else
                "RIGHT"

        number =
            if side == "LEFT" then
                Maybe.withDefault 0 line.oldLine

            else
                Maybe.withDefault 0 line.newLine

        decoration =
            moveDecoration model file.path side number
    in
    div [ class ("unified-line " ++ kindClass line.kind ++ decoration.className), id decoration.anchorId ]
        [ span [ class "line-number old" ] [ text (maybeNumber line.oldLine) ]
        , lineNumberButton model file.path side number line.newLine
        , span [ class "line-marker" ] [ text (kindMarker line.kind) ]
        , code [ class "line-code" ] (highlightedLine model file.path side number line.text)
        , decoration.button
        , lineThreads model file.path side number
        ]


type alias MoveDecoration =
    { className : String
    , anchorId : String
    , button : Html Msg
    }


moveDecoration : Model -> String -> String -> Int -> MoveDecoration
moveDecoration model path side lineNumber =
    let
        endpoint =
            if side == "LEFT" then
                Source

            else
                Destination

        move =
            case model.analysis of
                Success _ snapshot ->
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


lineNumberButton : Model -> String -> String -> Int -> Maybe Int -> Html Msg
lineNumberButton model path side number maybeNumberValue =
    if Route.isPullRequest model.location.target && maybeNumberValue /= Nothing then
        button [ type_ "button", class "line-number comment-trigger", attribute "title" "Add a GitHub review comment", onClick (OpenedInlineComposer path number side) ] [ text (maybeNumber maybeNumberValue) ]

    else
        span [ class "line-number" ] [ text (maybeNumber maybeNumberValue) ]


highlightedLine : Model -> String -> String -> Int -> String -> List (Html Msg)
highlightedLine model path side number source =
    case Dict.get path model.preparedFiles of
        Just prepared ->
            rangedSyntax model.settings.syntaxHighlighting path source (PreparedDiff.rangesFor side number prepared)

        Nothing ->
            Syntax.line model.settings.syntaxHighlighting path source


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


lineThreads : Model -> String -> String -> Int -> Html Msg
lineThreads model path side lineNumber =
    case model.comments of
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
    case model.comments of
        Success _ comments ->
            comments
                |> rootComments
                |> List.filter (\comment -> comment.path == path && comment.line == Nothing)
                |> List.map (threadView model comments)
                |> div [ class "detached-review-threads" ]

        Failure _ error ->
            div [ class "review-comments-error" ] [ text error ]

        _ ->
            text ""


rootComments : List ReviewComment -> List ReviewComment
rootComments =
    List.filter (\comment -> comment.id == comment.rootId)


threadView : Model -> List ReviewComment -> ReviewComment -> Html Msg
threadView model comments root =
    let
        collapsed =
            Set.member root.rootId model.collapsedThreads

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
    form [ class "review-reply-composer", onSubmit (SubmittedReply commentId) ]
        [ textarea [ placeholder "Reply on GitHub…", value (Dict.get commentId model.replyDrafts |> Maybe.withDefault ""), onInput (ChangedReply commentId) ] []
        , button [ type_ "submit", disabled (isRemoteLoading commentId model.replyState) ] [ text "Reply" ]
        , remoteError commentId model.replyState
        ]


inlineComposerFor : Model -> String -> Html Msg
inlineComposerFor model path =
    case model.inlineComposer of
        Just composer ->
            if composer.path /= path then
                text ""

            else
                form [ class "inline-comment-composer", onSubmit SubmittedInlineComment ]
                    [ header [] [ strong [] [ text ("Comment on " ++ path ++ ":" ++ String.fromInt composer.line) ], span [] [ text composer.side ] ]
                    , textarea [ id ("inline-comment-" ++ fileAnchor path), placeholder "Leave a review comment on GitHub…", value composer.body, onInput ChangedInlineBody ] []
                    , div []
                        [ button [ type_ "button", onClick CancelledInlineComposer ] [ text "Cancel" ]
                        , button [ type_ "submit", disabled (remoteIsLoading model.inlineSubmission) ] [ text "Add comment" ]
                        ]
                    , remoteAnyError model.inlineSubmission
                    ]

        Nothing ->
            text ""


commitsView : Model -> Html Msg
commitsView model =
    section [ class "commits-view" ]
        [ case model.location.commit of
            Just selectedSha ->
                div [ class "commit-detail" ]
                    [ button [ type_ "button", onClick (SelectedTab ReviewCommits) ] [ text "← All commits" ]
                    , h1 [] [ text ("Commit " ++ String.left 12 selectedSha) ]
                    , p [] [ text "This immutable commit diff is loaded through the same review endpoint." ]
                    ]

            Nothing ->
                case model.commits of
                    Loading _ ->
                        pageState "Loading commits…"

                    Failure _ error ->
                        div [ class "page-state is-error" ] [ text error ]

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
    form [ class "github-review-composer" ]
        [ h2 [] [ text "Submit review" ]
        , textarea [ placeholder "Leave an overall review…", value model.reviewBody, onInput ChangedReviewBody ] []
        , div []
            [ button [ type_ "button", onClick (SubmittedReview "COMMENT") ] [ text "Comment" ]
            , button [ type_ "button", onClick (SubmittedReview "APPROVE") ] [ text "Approve" ]
            , button [ type_ "button", onClick (SubmittedReview "REQUEST_CHANGES") ] [ text "Request changes" ]
            ]
        , remoteAnyError model.reviewSubmission
        ]


fullFileDiff : Model -> FileChange -> FullFile -> Html Msg
fullFileDiff model file full =
    let
        rows =
            Diff.fullFileRowsPrepared (preparedHunks model file.path) full.oldText full.newText
    in
    div [ class "full-file-diff" ]
        (if model.settings.viewMode == Split then
            List.map (splitRowView model file) rows

         else
            rows
                |> List.concatMap fullUnifiedLines
                |> List.map (unifiedLineView model file)
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
    Dict.get path model.preparedFiles
        |> Maybe.map .hunks
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


toggleSet : comparable -> Set comparable -> Set comparable
toggleSet item set =
    if Set.member item set then
        Set.remove item set

    else
        Set.insert item set


mapSuccess : (value -> value) -> Remote identity error value -> Remote identity error value
mapSuccess transform remote =
    case remote of
        Success identity value ->
            Success identity (transform value)

        _ ->
            remote


remoteIsLoading : Remote identity error value -> Bool
remoteIsLoading remote =
    case remote of
        Loading _ ->
            True

        _ ->
            False


isRemoteLoading : comparable -> Remote comparable error value -> Bool
isRemoteLoading identity remote =
    case remote of
        Loading current ->
            current == identity

        _ ->
            False


remoteError : comparable -> Remote comparable String value -> Html msg
remoteError identity remote =
    case remote of
        Failure current error ->
            if current == identity then
                span [ class "form-error" ] [ text error ]

            else
                text ""

        _ ->
            text ""


remoteAnyError : Remote identity String value -> Html msg
remoteAnyError remote =
    case remote of
        Failure _ error ->
            span [ class "form-error" ] [ text error ]

        _ ->
            text ""


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
