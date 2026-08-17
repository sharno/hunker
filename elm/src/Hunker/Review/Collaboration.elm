module Hunker.Review.Collaboration exposing
    ( FileState
    , InlineComposer
    , InlineRequest
    , InlineSubmission
    , Model
    , ReplyRequest
    , ReplySubmission
    , ReviewRequest
    , ReviewSubmission
    , ReviewSubmissionState(..)
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
    , fileComments
    , fileState
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
    , reviewFailed
    , reviewLoaded
    , reviewSubmissionState
    , revision
    , revisionFailed
    , revisionLoaded
    , session
    , submitInline
    , toggleThread
    )

import Dict exposing (Dict)
import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Review exposing (CommentSide, PullCommit, ReviewAction, ReviewComment, Revision)
import Hunker.Remote as Remote exposing (Remote(..))
import Hunker.Review.Session as Session
import Set exposing (Set)


type Model
    = Model Details


type alias Details =
    { session : Session.Id
    , commits : Remote Session.Id ApiError (List PullCommit)
    , revision : Remote Session.Id ApiError Revision
    , files : Dict String FileState
    , commentPaths : Dict Int String
    , inlinePath : Maybe String
    , reviewBody : String
    , reviewSubmission : Remote ReviewRequest ApiError ReviewAction
    }


type FileState
    = FileState FileDetails


type alias FileDetails =
    { comments : Remote Session.Id ApiError (List ReviewComment)
    , collapsedThreads : Set Int
    , replyDrafts : Dict Int String
    , replyState : Remote ReplyRequest ApiError ReviewComment
    , inlineComposer : Maybe InlineComposer
    , inlineSubmission : Remote InlineRequest ApiError ReviewComment
    }


type ReplyRequest
    = ReplyRequest Session.Id Int


type ReviewRequest
    = ReviewRequest Session.Id ReviewAction


type ReviewSubmissionState
    = ReviewNotSubmitted
    | ReviewSubmitting ReviewAction
    | ReviewSucceeded ReviewAction
    | ReviewSubmissionFailed ApiError


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
    , event : ReviewAction
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


init : Session.Id -> Bool -> List String -> Model
init sessionId loadCommits paths =
    Model
        { session = sessionId
        , commits =
            if loadCommits then
                Loading sessionId

            else
                NotAsked
        , revision = NotAsked
        , files = Dict.fromList (List.map (\path -> ( path, emptyFileState )) paths)
        , commentPaths = Dict.empty
        , inlinePath = Nothing
        , reviewBody = ""
        , reviewSubmission = NotAsked
        }


emptyFileState : FileState
emptyFileState =
    FileState
        { comments = NotAsked
        , collapsedThreads = Set.empty
        , replyDrafts = Dict.empty
        , replyState = NotAsked
        , inlineComposer = Nothing
        , inlineSubmission = NotAsked
        }


session : Model -> Session.Id
session (Model details) =
    details.session


commits : Model -> Remote Session.Id ApiError (List PullCommit)
commits (Model details) =
    details.commits


revision : Model -> Remote Session.Id ApiError Revision
revision (Model details) =
    details.revision


fileState : String -> Model -> Maybe FileState
fileState path (Model details) =
    Dict.get path details.files


comments : Model -> Remote Session.Id ApiError (List ReviewComment)
comments (Model details) =
    details.files
        |> Dict.values
        |> List.map fileComments
        |> combineComments details.session


combineComments : Session.Id -> List (Remote Session.Id ApiError (List ReviewComment)) -> Remote Session.Id ApiError (List ReviewComment)
combineComments requested states =
    case states of
        [] ->
            NotAsked

        _ ->
            case List.filterMap successValue states of
                values ->
                    if List.length values == List.length states then
                        Success requested (List.concat values)

                    else
                        states
                            |> List.filterMap failureValue
                            |> List.head
                            |> Maybe.map (Failure requested)
                            |> Maybe.withDefault
                                (if List.any Remote.isLoading states then
                                    Loading requested

                                 else
                                    NotAsked
                                )


successValue : Remote request error value -> Maybe value
successValue remote =
    case remote of
        Success _ value ->
            Just value

        _ ->
            Nothing


failureValue : Remote request error value -> Maybe error
failureValue remote =
    case remote of
        Failure _ error ->
            Just error

        _ ->
            Nothing


fileComments : FileState -> Remote Session.Id ApiError (List ReviewComment)
fileComments (FileState details) =
    details.comments


commitsLoaded : Session.Id -> List PullCommit -> Model -> Model
commitsLoaded requested value =
    mapIfCurrent requested (\details -> { details | commits = Success requested value })


commitsFailed : Session.Id -> ApiError -> Model -> Model
commitsFailed requested error =
    mapIfCurrent requested (\details -> { details | commits = Failure requested error })


beginComments : Model -> Model
beginComments (Model details) =
    Model { details | files = Dict.map (\_ -> mapFile (\file -> { file | comments = Loading details.session })) details.files }


commentsLoaded : Session.Id -> List ReviewComment -> Model -> Model
commentsLoaded requested values ((Model details) as model) =
    if requested /= details.session then
        model

    else
        let
            paths =
                values |> List.map .path |> Set.fromList

            ensured =
                Set.foldl (\path -> Dict.update path (Just << Maybe.withDefault emptyFileState)) details.files paths

            commentsByPath =
                List.foldr (\comment -> Dict.update comment.path (Just << (::) comment << Maybe.withDefault [])) Dict.empty values

            update path (FileState file) =
                let
                    fileComments_ =
                        Dict.get path commentsByPath |> Maybe.withDefault []

                    resolved =
                        fileComments_
                            |> List.filter (\comment -> comment.id == comment.rootId && comment.resolved)
                            |> List.map .rootId
                            |> Set.fromList
                in
                FileState
                    { file
                        | comments = Success requested fileComments_
                        , collapsedThreads = Set.union file.collapsedThreads resolved
                    }
        in
        Model
            { details
                | files = Dict.map update ensured
                , commentPaths = Dict.fromList (List.map (\comment -> ( comment.id, comment.path )) values)
            }


commentsFailed : Session.Id -> ApiError -> Model -> Model
commentsFailed requested error =
    mapIfCurrent requested (\details -> { details | files = Dict.map (\_ -> mapFile (\file -> { file | comments = Failure requested error })) details.files })


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
toggleThread threadId =
    updateCommentFile threadId (mapFile (\file -> { file | collapsedThreads = toggleSet threadId file.collapsedThreads }))


isThreadCollapsed : Int -> FileState -> Bool
isThreadCollapsed threadId (FileState details) =
    Set.member threadId details.collapsedThreads


changeReply : Int -> String -> Model -> Model
changeReply commentId body =
    updateCommentFile commentId (mapFile (\file -> { file | replyDrafts = Dict.insert commentId body file.replyDrafts, replyState = NotAsked }))


replyDraft : Int -> FileState -> String
replyDraft commentId (FileState details) =
    Dict.get commentId details.replyDrafts |> Maybe.withDefault ""


beginReply : Int -> Model -> ( Model, Maybe ReplySubmission )
beginReply commentId ((Model details) as model) =
    case Dict.get commentId details.commentPaths |> Maybe.andThen (\path -> Dict.get path details.files |> Maybe.map (Tuple.pair path)) of
        Nothing ->
            ( model, Nothing )

        Just ( path, fileState_ ) ->
            let
                body =
                    replyDraft commentId fileState_

                request =
                    ReplyRequest details.session commentId
            in
            if String.trim body == "" then
                ( model, Nothing )

            else
                ( updateFile path (mapFile (\file -> { file | replyState = Loading request })) model
                , Just { request = request, pullUrl = Session.pullUrl details.session, commentId = commentId, body = body }
                )


replyLoaded : ReplyRequest -> ReviewComment -> Model -> Model
replyLoaded request comment ((Model details) as model) =
    let
        commentId =
            replyCommentId request
    in
    if not (replyBelongsTo details.session request) then
        model

    else
        updateCommentFile commentId
            (\state ->
                if replyLoading commentId state then
                    mapFile
                        (\file ->
                            { file
                                | comments = Remote.map (\value -> value ++ [ comment ]) file.comments
                                , replyDrafts = Dict.remove commentId file.replyDrafts
                                , replyState = Success request comment
                            }
                        )
                        state

                else
                    state
            )
            model


replyFailed : ReplyRequest -> ApiError -> Model -> Model
replyFailed request error ((Model details) as model) =
    let
        commentId =
            replyCommentId request
    in
    if replyBelongsTo details.session request then
        updateCommentFile commentId
            (\state ->
                if replyLoading commentId state then
                    mapFile (\file -> { file | replyState = Failure request error }) state

                else
                    state
            )
            model

    else
        model


replyLoading : Int -> FileState -> Bool
replyLoading commentId (FileState details) =
    case details.replyState of
        Loading request ->
            replyCommentId request == commentId

        _ ->
            False


replyError : Int -> FileState -> Maybe ApiError
replyError commentId (FileState details) =
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


beginReview : ReviewAction -> Model -> ( Model, ReviewSubmission )
beginReview event (Model details) =
    let
        request =
            ReviewRequest details.session event
    in
    ( Model { details | reviewSubmission = Loading request }
    , { request = request, pullUrl = Session.pullUrl details.session, event = event, body = details.reviewBody }
    )


reviewLoaded : ReviewRequest -> ReviewAction -> Model -> Model
reviewLoaded request response ((Model details) as model) =
    if Remote.identity details.reviewSubmission == Just request && reviewBelongsTo details.session request then
        Model { details | reviewSubmission = Success request response, reviewBody = "" }

    else
        model


reviewFailed : ReviewRequest -> ApiError -> Model -> Model
reviewFailed request error ((Model details) as model) =
    if Remote.identity details.reviewSubmission == Just request && reviewBelongsTo details.session request then
        Model { details | reviewSubmission = Failure request error }

    else
        model


reviewSubmissionState : Model -> ReviewSubmissionState
reviewSubmissionState (Model details) =
    case details.reviewSubmission of
        NotAsked ->
            ReviewNotSubmitted

        Loading (ReviewRequest _ action) ->
            ReviewSubmitting action

        Success _ action ->
            ReviewSucceeded action

        Failure _ error ->
            ReviewSubmissionFailed error


openInline : String -> Int -> CommentSide -> Model -> Model
openInline path line side ((Model details) as model) =
    let
        cleared =
            details.inlinePath
                |> Maybe.map (\previous -> updateFile previous clearInline model)
                |> Maybe.withDefault model

        composer =
            { path = path, line = line, side = side, body = "" }
    in
    cleared
        |> updateFile path (mapFile (\file -> { file | inlineComposer = Just composer, inlineSubmission = NotAsked }))
        |> setInlinePath (Just path)


changeInlineBody : String -> Model -> Model
changeInlineBody body ((Model details) as model) =
    details.inlinePath
        |> Maybe.map (\path -> updateFile path (mapFile (\file -> { file | inlineComposer = Maybe.map (\composer -> { composer | body = body }) file.inlineComposer })) model)
        |> Maybe.withDefault model


cancelInline : Model -> Model
cancelInline ((Model details) as model) =
    details.inlinePath
        |> Maybe.map (\path -> updateFile path clearInline model |> setInlinePath Nothing)
        |> Maybe.withDefault model


clearInline : FileState -> FileState
clearInline =
    mapFile (\file -> { file | inlineComposer = Nothing, inlineSubmission = NotAsked })


inlineComposer : FileState -> Maybe InlineComposer
inlineComposer (FileState details) =
    details.inlineComposer


submitInline : Model -> ( Model, Maybe InlineSubmission )
submitInline ((Model details) as model) =
    case details.inlinePath |> Maybe.andThen (\path -> Dict.get path details.files |> Maybe.map (Tuple.pair path)) of
        Nothing ->
            ( model, Nothing )

        Just ( path, FileState file ) ->
            case file.inlineComposer of
                Just composer ->
                    if String.trim composer.body == "" then
                        ( model, Nothing )

                    else
                        let
                            request =
                                InlineRequest details.session composer.path composer.line composer.side
                        in
                        ( updateFile path (mapFile (\current -> { current | inlineSubmission = Loading request })) model
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
    if not (inlineBelongsTo details.session request) then
        model

    else
        case fileState (inlinePath request) model of
            Just state ->
                if inlineRequestActive request state then
                    updateFile (inlinePath request)
                        (mapFile
                            (\file ->
                                { file
                                    | comments = Remote.map (\value -> value ++ [ comment ]) file.comments
                                    , inlineComposer = Nothing
                                    , inlineSubmission = Success request comment
                                }
                            )
                        )
                        model
                        |> setInlinePath Nothing
                        |> insertCommentPath comment

                else
                    model

            Nothing ->
                model


inlineFailed : InlineRequest -> ApiError -> Model -> Model
inlineFailed request error ((Model details) as model) =
    if inlineBelongsTo details.session request then
        updateFile (inlinePath request)
            (\state ->
                if inlineRequestActive request state then
                    mapFile (\file -> { file | inlineSubmission = Failure request error }) state

                else
                    state
            )
            model

    else
        model


inlineLoading : FileState -> Bool
inlineLoading (FileState details) =
    Remote.isLoading details.inlineSubmission


inlineError : FileState -> Maybe ApiError
inlineError (FileState details) =
    case details.inlineSubmission of
        Failure _ error ->
            Just error

        _ ->
            Nothing


inlineRequestActive : InlineRequest -> FileState -> Bool
inlineRequestActive request (FileState details) =
    Remote.identity details.inlineSubmission == Just request


mapIfCurrent : Session.Id -> (Details -> Details) -> Model -> Model
mapIfCurrent requested transform ((Model details) as model) =
    if requested == details.session then
        Model (transform details)

    else
        model


updateCommentFile : Int -> (FileState -> FileState) -> Model -> Model
updateCommentFile commentId transform ((Model details) as model) =
    details.commentPaths
        |> Dict.get commentId
        |> Maybe.map (\path -> updateFile path transform model)
        |> Maybe.withDefault model


updateFile : String -> (FileState -> FileState) -> Model -> Model
updateFile path transform (Model details) =
    Model { details | files = Dict.update path (Maybe.map transform) details.files }


mapFile : (FileDetails -> FileDetails) -> FileState -> FileState
mapFile transform (FileState details) =
    FileState (transform details)


setInlinePath : Maybe String -> Model -> Model
setInlinePath path (Model details) =
    Model { details | inlinePath = path }


insertCommentPath : ReviewComment -> Model -> Model
insertCommentPath comment (Model details) =
    Model { details | commentPaths = Dict.insert comment.id comment.path details.commentPaths }


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


inlinePath : InlineRequest -> String
inlinePath (InlineRequest _ path _ _) =
    path


toggleSet : comparable -> Set comparable -> Set comparable
toggleSet item values =
    if Set.member item values then
        Set.remove item values

    else
        Set.insert item values
