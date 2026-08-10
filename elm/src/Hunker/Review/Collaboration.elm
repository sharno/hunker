module Hunker.Review.Collaboration exposing
    ( InlineComposer
    , InlineRequest
    , InlineSubmission
    , Model
    , ReplyRequest
    , ReplySubmission
    , ReviewRequest
    , ReviewSubmission
    , beginComments
    , beginReply
    , beginReview
    , beginRevision
    , cancelInline
    , changeInlineBody
    , changeReply
    , changeReviewBody
    , comments
    , commentsFailed
    , commentsLoaded
    , commits
    , commitsFailed
    , commitsLoaded
    , init
    , inlineComposer
    , inlineError
    , inlineFailed
    , inlineLoaded
    , inlineLoading
    , isThreadCollapsed
    , openInline
    , replyDraft
    , replyError
    , replyFailed
    , replyLoaded
    , replyLoading
    , reviewBody
    , reviewError
    , reviewFailed
    , reviewLoaded
    , revision
    , revisionFailed
    , revisionLoaded
    , session
    , submitInline
    , toggleThread
    )

import Dict exposing (Dict)
import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Review exposing (CommentSide, PullCommit, ReviewComment, Revision)
import Hunker.Remote as Remote exposing (Remote(..))
import Hunker.Review.Session as Session
import Set exposing (Set)


type Model
    = Model Details


type alias Details =
    { session : Session.Id
    , commits : Remote Session.Id ApiError (List PullCommit)
    , comments : Remote Session.Id ApiError (List ReviewComment)
    , revision : Remote Session.Id ApiError Revision
    , collapsedThreads : Set Int
    , replyDrafts : Dict Int String
    , replyState : Remote ReplyRequest ApiError ReviewComment
    , reviewBody : String
    , reviewSubmission : Remote ReviewRequest ApiError String
    , inlineComposer : Maybe InlineComposer
    , inlineSubmission : Remote InlineRequest ApiError ReviewComment
    }


type ReplyRequest
    = ReplyRequest Session.Id Int


type ReviewRequest
    = ReviewRequest Session.Id String


type InlineRequest
    = InlineRequest Session.Id String Int CommentSide


type alias ReplySubmission =
    { request : ReplyRequest
    , pullUrl : String
    , commentId : Int
    , body : String
    }


type alias ReviewSubmission =
    { request : ReviewRequest
    , pullUrl : String
    , event : String
    , body : String
    }


type alias InlineSubmission =
    { request : InlineRequest
    , pullUrl : String
    , commitId : String
    , path : String
    , line : Int
    , side : CommentSide
    , body : String
    }


type alias InlineComposer =
    { path : String
    , line : Int
    , side : CommentSide
    , body : String
    }


init : Session.Id -> Bool -> Model
init sessionId loadCommits =
    Model
        { session = sessionId
        , commits =
            if loadCommits then
                Loading sessionId

            else
                NotAsked
        , comments = NotAsked
        , revision = NotAsked
        , collapsedThreads = Set.empty
        , replyDrafts = Dict.empty
        , replyState = NotAsked
        , reviewBody = ""
        , reviewSubmission = NotAsked
        , inlineComposer = Nothing
        , inlineSubmission = NotAsked
        }


session : Model -> Session.Id
session (Model details) =
    details.session


commits : Model -> Remote Session.Id ApiError (List PullCommit)
commits (Model details) =
    details.commits


comments : Model -> Remote Session.Id ApiError (List ReviewComment)
comments (Model details) =
    details.comments


revision : Model -> Remote Session.Id ApiError Revision
revision (Model details) =
    details.revision


commitsLoaded : Session.Id -> List PullCommit -> Model -> Model
commitsLoaded requested value =
    mapIfCurrent requested (\details -> { details | commits = Success requested value })


commitsFailed : Session.Id -> ApiError -> Model -> Model
commitsFailed requested error =
    mapIfCurrent requested (\details -> { details | commits = Failure requested error })


beginComments : Model -> Model
beginComments (Model details) =
    Model { details | comments = Loading details.session }


commentsLoaded : Session.Id -> List ReviewComment -> Model -> Model
commentsLoaded requested value =
    mapIfCurrent requested <|
        \details ->
            let
                resolved =
                    value
                        |> List.filter (\comment -> comment.id == comment.rootId && comment.resolved)
                        |> List.map .rootId
                        |> Set.fromList
            in
            { details
                | comments = Success requested value
                , collapsedThreads = Set.union details.collapsedThreads resolved
            }


commentsFailed : Session.Id -> ApiError -> Model -> Model
commentsFailed requested error =
    mapIfCurrent requested (\details -> { details | comments = Failure requested error })


beginRevision : Model -> Model
beginRevision (Model details) =
    Model { details | revision = Loading details.session }


revisionLoaded : Session.Id -> Revision -> Model -> Model
revisionLoaded requested value =
    mapIfCurrent requested (\details -> { details | revision = Success requested value })


revisionFailed : Session.Id -> ApiError -> Model -> Model
revisionFailed requested error =
    mapIfCurrent requested (\details -> { details | revision = Failure requested error })


toggleThread : Int -> Model -> Model
toggleThread threadId (Model details) =
    Model
        { details
            | collapsedThreads = toggleSet threadId details.collapsedThreads
        }


isThreadCollapsed : Int -> Model -> Bool
isThreadCollapsed threadId (Model details) =
    Set.member threadId details.collapsedThreads


changeReply : Int -> String -> Model -> Model
changeReply commentId body (Model details) =
    Model
        { details
            | replyDrafts = Dict.insert commentId body details.replyDrafts
            , replyState = NotAsked
        }


replyDraft : Int -> Model -> String
replyDraft commentId (Model details) =
    Dict.get commentId details.replyDrafts |> Maybe.withDefault ""


beginReply : Int -> Model -> ( Model, Maybe ReplySubmission )
beginReply commentId ((Model details) as model) =
    let
        body =
            replyDraft commentId model

        request =
            ReplyRequest details.session commentId
    in
    if String.trim body == "" then
        ( model, Nothing )

    else
        ( Model { details | replyState = Loading request }
        , Just
            { request = request
            , pullUrl = Session.pullUrl details.session
            , commentId = commentId
            , body = body
            }
        )


replyLoaded : ReplyRequest -> ReviewComment -> Model -> Model
replyLoaded request comment ((Model details) as model) =
    if Remote.identity details.replyState /= Just request || not (replyBelongsTo details.session request) then
        model

    else
        let
            commentId =
                replyCommentId request
        in
        Model
            { details
                | comments = Remote.map (\value -> value ++ [ comment ]) details.comments
                , replyDrafts = Dict.remove commentId details.replyDrafts
                , replyState = Success request comment
            }


replyFailed : ReplyRequest -> ApiError -> Model -> Model
replyFailed request error ((Model details) as model) =
    if Remote.identity details.replyState == Just request && replyBelongsTo details.session request then
        Model { details | replyState = Failure request error }

    else
        model


replyLoading : Int -> Model -> Bool
replyLoading commentId (Model details) =
    case details.replyState of
        Loading request ->
            replyCommentId request == commentId

        _ ->
            False


replyError : Int -> Model -> Maybe ApiError
replyError commentId (Model details) =
    case details.replyState of
        Failure request error ->
            if replyCommentId request == commentId then
                Just error

            else
                Nothing

        _ ->
            Nothing


changeReviewBody : String -> Model -> Model
changeReviewBody body (Model details) =
    Model { details | reviewBody = body, reviewSubmission = NotAsked }


reviewBody : Model -> String
reviewBody (Model details) =
    details.reviewBody


beginReview : String -> Model -> ( Model, ReviewSubmission )
beginReview event (Model details) =
    let
        request =
            ReviewRequest details.session event
    in
    ( Model { details | reviewSubmission = Loading request }
    , { request = request
      , pullUrl = Session.pullUrl details.session
      , event = event
      , body = details.reviewBody
      }
    )


reviewLoaded : ReviewRequest -> String -> Model -> Model
reviewLoaded request response ((Model details) as model) =
    if Remote.identity details.reviewSubmission == Just request && reviewBelongsTo details.session request then
        Model
            { details
                | reviewSubmission = Success request response
                , reviewBody = ""
            }

    else
        model


reviewFailed : ReviewRequest -> ApiError -> Model -> Model
reviewFailed request error ((Model details) as model) =
    if Remote.identity details.reviewSubmission == Just request && reviewBelongsTo details.session request then
        Model { details | reviewSubmission = Failure request error }

    else
        model


reviewError : Model -> Maybe ApiError
reviewError (Model details) =
    case details.reviewSubmission of
        Failure _ error ->
            Just error

        _ ->
            Nothing


openInline : String -> Int -> CommentSide -> Model -> Model
openInline path line side (Model details) =
    Model
        { details
            | inlineComposer = Just { path = path, line = line, side = side, body = "" }
            , inlineSubmission = NotAsked
        }


changeInlineBody : String -> Model -> Model
changeInlineBody body (Model details) =
    Model
        { details
            | inlineComposer = Maybe.map (\composer -> { composer | body = body }) details.inlineComposer
        }


cancelInline : Model -> Model
cancelInline (Model details) =
    Model { details | inlineComposer = Nothing, inlineSubmission = NotAsked }


inlineComposer : Model -> Maybe InlineComposer
inlineComposer (Model details) =
    details.inlineComposer


submitInline : Model -> ( Model, Maybe InlineSubmission )
submitInline ((Model details) as model) =
    case details.inlineComposer of
        Just composer ->
            if String.trim composer.body == "" then
                ( model, Nothing )

            else
                let
                    request =
                        InlineRequest details.session composer.path composer.line composer.side
                in
                ( Model { details | inlineSubmission = Loading request }
                , Just
                    { request = request
                    , pullUrl = Session.pullUrl details.session
                    , commitId = Session.headOid details.session
                    , path = composer.path
                    , line = composer.line
                    , side = composer.side
                    , body = composer.body
                    }
                )

        Nothing ->
            ( model, Nothing )


inlineLoaded : InlineRequest -> ReviewComment -> Model -> Model
inlineLoaded request comment ((Model details) as model) =
    if Remote.identity details.inlineSubmission == Just request && inlineBelongsTo details.session request then
        Model
            { details
                | comments = Remote.map (\value -> value ++ [ comment ]) details.comments
                , inlineComposer = Nothing
                , inlineSubmission = Success request comment
            }

    else
        model


inlineFailed : InlineRequest -> ApiError -> Model -> Model
inlineFailed request error ((Model details) as model) =
    if Remote.identity details.inlineSubmission == Just request && inlineBelongsTo details.session request then
        Model { details | inlineSubmission = Failure request error }

    else
        model


inlineLoading : Model -> Bool
inlineLoading (Model details) =
    Remote.isLoading details.inlineSubmission


inlineError : Model -> Maybe ApiError
inlineError (Model details) =
    case details.inlineSubmission of
        Failure _ error ->
            Just error

        _ ->
            Nothing


mapIfCurrent : Session.Id -> (Details -> Details) -> Model -> Model
mapIfCurrent requested transform ((Model details) as model) =
    if requested == details.session then
        Model (transform details)

    else
        model


replyBelongsTo : Session.Id -> ReplyRequest -> Bool
replyBelongsTo active (ReplyRequest requested _) =
    active == requested


replyCommentId : ReplyRequest -> Int
replyCommentId (ReplyRequest _ commentId) =
    commentId


reviewBelongsTo : Session.Id -> ReviewRequest -> Bool
reviewBelongsTo active (ReviewRequest requested _) =
    active == requested


inlineBelongsTo : Session.Id -> InlineRequest -> Bool
inlineBelongsTo active (InlineRequest requested _ _ _) =
    active == requested


toggleSet : comparable -> Set comparable -> Set comparable
toggleSet item values =
    if Set.member item values then
        Set.remove item values

    else
        Set.insert item values
