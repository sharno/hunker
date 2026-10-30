module Hunker.Review.Collaboration exposing
    ( Anchor
    , FileState
    , Inline(..)
    , InlineRequest
    , InlineSubmission
    , Model
    , ReplyDraft(..)
    , ReplyRequest
    , ReplySubmission
    , ReviewDraft(..)
    , ReviewOutcome(..)
    , ReviewRequest
    , ReviewSubmission
    , Thread
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
    , detachedThreads
    , fileState
    , init
    , inline
    , inlineFailed
    , inlineLoaded
    , isThreadCollapsed
    , noFileState
    , openInline
    , pull
    , replyDraft
    , replyFailed
    , replyLoaded
    , reviewDraft
    , reviewFailed
    , reviewLoaded
    , reviewRequestAction
    , revision
    , revisionFailed
    , revisionLoaded
    , session
    , submitInline
    , threadsAt
    , toggleThread
    )

{-| GitHub collaboration for one pull-request review.

Every draft owns its in-flight state: a reply draft per thread, one inline
composer per file, and one review summary. A draft that is sending cannot be
edited or resubmitted, and a response only settles the draft that sent it.

Per-file state is stored, not derived, so each lazily rendered file panel
receives a stable value.

-}

import Dict exposing (Dict)
import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Review exposing (CommentSide(..), PullCommit, ReviewAction(..), ReviewComment, Revision)
import Hunker.Remote exposing (Remote(..))
import Hunker.Review.Session as Session
import Hunker.Route exposing (PullRequestRef)
import Set exposing (Set)


type Model
    = Model Details


type alias Details =
    { session : Session.Id
    , pull : PullRequestRef
    , commits : Remote Session.Id ApiError (List PullCommit)
    , revision : Remote Session.Id ApiError Revision
    , comments : Remote Session.Id ApiError ()
    , files : Dict String FileState
    , review : ReviewDraft
    }


type FileState
    = FileState FileDetails


type alias FileDetails =
    { threads : FileThreads
    , collapsed : Set Int
    , replies : Dict Int ReplyDraft
    , inline : Inline
    }


{-| Threads indexed once by side and line, so rendering a line never scans
the file's comments.
-}
type alias FileThreads =
    { left : Dict Int (List Thread)
    , right : Dict Int (List Thread)
    , detached : List Thread
    }


type alias Thread =
    { root : ReviewComment
    , replies : List ReviewComment
    }


type alias Anchor =
    { path : String
    , line : Int
    , side : CommentSide
    }


type ReplyDraft
    = EditingReply String (Maybe ApiError)
    | SendingReply ReplyRequest String


type Inline
    = InlineClosed
    | Composing Anchor String (Maybe ApiError)
    | SubmittingInline InlineRequest Anchor String


type ReviewDraft
    = DraftingReview String (Maybe ReviewOutcome)
    | SubmittingReview ReviewRequest String


type ReviewOutcome
    = ReviewAccepted ReviewAction
    | ReviewRejected ApiError


type ReplyRequest
    = ReplyRequest Session.Id String Int


type InlineRequest
    = InlineRequest Session.Id Anchor


type ReviewRequest
    = ReviewRequest Session.Id ReviewAction


type alias ReplySubmission =
    { request : ReplyRequest
    , pull : PullRequestRef
    , commentId : Int
    , body : String
    }


type alias InlineSubmission =
    { request : InlineRequest
    , anchor : Anchor
    , body : String
    }


type alias ReviewSubmission =
    { request : ReviewRequest
    , pull : PullRequestRef
    , action : ReviewAction
    , body : String
    }


init : Session.Id -> PullRequestRef -> Model
init sessionId pullRequest =
    Model
        { session = sessionId
        , pull = pullRequest
        , commits = Loading sessionId
        , revision = NotAsked
        , comments = NotAsked
        , files = Dict.empty
        , review = DraftingReview "" Nothing
        }


{-| File state for files without collaboration, shared so lazy panels keep a
stable argument.
-}
noFileState : FileState
noFileState =
    emptyFileState


emptyFileState : FileState
emptyFileState =
    FileState
        { threads = emptyThreads
        , collapsed = Set.empty
        , replies = Dict.empty
        , inline = InlineClosed
        }


session : Model -> Session.Id
session (Model details) =
    details.session


pull : Model -> PullRequestRef
pull (Model details) =
    details.pull


fileState : String -> Model -> FileState
fileState path (Model details) =
    Dict.get path details.files |> Maybe.withDefault emptyFileState


updateFile : String -> (FileDetails -> FileDetails) -> Model -> Model
updateFile path transform ((Model details) as model) =
    let
        (FileState current) =
            fileState path model
    in
    Model { details | files = Dict.insert path (FileState (transform current)) details.files }


settle : Session.Id -> Remote Session.Id ApiError value -> Remote Session.Id ApiError value -> Remote Session.Id ApiError value
settle requested result current =
    case current of
        Loading active ->
            if active == requested then
                result

            else
                current

        NotAsked ->
            current

        Success _ _ ->
            current

        Failure _ _ ->
            current



-- COMMITS AND REVISION


commits : Model -> Remote Session.Id ApiError (List PullCommit)
commits (Model details) =
    details.commits


commitsLoaded : Session.Id -> List PullCommit -> Model -> Model
commitsLoaded requested value (Model details) =
    Model { details | commits = settle requested (Success requested value) details.commits }


commitsFailed : Session.Id -> ApiError -> Model -> Model
commitsFailed requested error (Model details) =
    Model { details | commits = settle requested (Failure requested error) details.commits }


revision : Model -> Remote Session.Id ApiError Revision
revision (Model details) =
    details.revision


beginRevision : Model -> ( Model, Session.Id )
beginRevision (Model details) =
    ( Model { details | revision = Loading details.session }, details.session )


revisionLoaded : Session.Id -> Revision -> Model -> Model
revisionLoaded requested value (Model details) =
    Model { details | revision = settle requested (Success requested value) details.revision }


revisionFailed : Session.Id -> ApiError -> Model -> Model
revisionFailed requested error (Model details) =
    Model { details | revision = settle requested (Failure requested error) details.revision }



-- COMMENTS


{-| Review-wide comment loading, rendered once near the review toolbar.
-}
comments : Model -> Remote Session.Id ApiError ()
comments (Model details) =
    details.comments


{-| Starts loading comments unless they are already loading or loaded.
-}
beginComments : Model -> Maybe ( Model, Session.Id )
beginComments (Model details) =
    let
        start =
            Just ( Model { details | comments = Loading details.session }, details.session )
    in
    case details.comments of
        NotAsked ->
            start

        Failure _ _ ->
            start

        Loading _ ->
            Nothing

        Success _ _ ->
            Nothing


commentsLoaded : Session.Id -> List ReviewComment -> Model -> Model
commentsLoaded requested values ((Model details) as model) =
    case details.comments of
        Loading active ->
            if active == requested then
                Dict.foldl
                    (\path threads ->
                        updateFile path
                            (\file ->
                                { file
                                    | threads = threads
                                    , collapsed = Set.union file.collapsed (resolvedRoots threads)
                                }
                            )
                    )
                    (Model { details | comments = Success requested () })
                    (indexThreads values)

            else
                model

        NotAsked ->
            model

        Success _ _ ->
            model

        Failure _ _ ->
            model


commentsFailed : Session.Id -> ApiError -> Model -> Model
commentsFailed requested error (Model details) =
    Model { details | comments = settle requested (Failure requested error) details.comments }


indexThreads : List ReviewComment -> Dict String FileThreads
indexThreads values =
    let
        repliesByRoot =
            List.foldr
                (\comment ->
                    if comment.id == comment.rootId then
                        identity

                    else
                        Dict.update comment.rootId (Maybe.withDefault [] >> (::) comment >> Just)
                )
                Dict.empty
                values

        threadsByPath =
            values
                |> List.filter (\comment -> comment.id == comment.rootId)
                |> List.foldr
                    (\root ->
                        Dict.update root.path
                            (Maybe.withDefault [] >> (::) { root = root, replies = Dict.get root.id repliesByRoot |> Maybe.withDefault [] } >> Just)
                    )
                    Dict.empty
    in
    Dict.map (\_ threads -> List.foldr placeThread emptyThreads threads) threadsByPath


emptyThreads : FileThreads
emptyThreads =
    { left = Dict.empty, right = Dict.empty, detached = [] }


placeThread : Thread -> FileThreads -> FileThreads
placeThread thread threads =
    case ( thread.root.line, thread.root.side ) of
        ( Just line, LeftSide ) ->
            { threads | left = Dict.update line (Maybe.withDefault [] >> (::) thread >> Just) threads.left }

        ( Just line, RightSide ) ->
            { threads | right = Dict.update line (Maybe.withDefault [] >> (::) thread >> Just) threads.right }

        ( Nothing, _ ) ->
            { threads | detached = thread :: threads.detached }


resolvedRoots : FileThreads -> Set Int
resolvedRoots threads =
    allThreads threads
        |> List.filter (.root >> .resolved)
        |> List.map (.root >> .id)
        |> Set.fromList


allThreads : FileThreads -> List Thread
allThreads threads =
    List.concat (Dict.values threads.left) ++ List.concat (Dict.values threads.right) ++ threads.detached


{-| Adds a newly posted comment: a root opens a thread, a reply joins its
root's thread.
-}
addComment : ReviewComment -> FileThreads -> FileThreads
addComment comment threads =
    if comment.id == comment.rootId then
        placeThread { root = comment, replies = [] } threads

    else
        let
            join thread =
                if thread.root.id == comment.rootId then
                    { thread | replies = thread.replies ++ [ comment ] }

                else
                    thread
        in
        { left = Dict.map (\_ -> List.map join) threads.left
        , right = Dict.map (\_ -> List.map join) threads.right
        , detached = List.map join threads.detached
        }


threadsAt : CommentSide -> Int -> FileState -> List Thread
threadsAt side line (FileState file) =
    Dict.get line
        (case side of
            LeftSide ->
                file.threads.left

            RightSide ->
                file.threads.right
        )
        |> Maybe.withDefault []


detachedThreads : FileState -> List Thread
detachedThreads (FileState file) =
    file.threads.detached


toggleThread : String -> Int -> Model -> Model
toggleThread path threadId =
    updateFile path
        (\file ->
            { file
                | collapsed =
                    if Set.member threadId file.collapsed then
                        Set.remove threadId file.collapsed

                    else
                        Set.insert threadId file.collapsed
            }
        )


isThreadCollapsed : Int -> FileState -> Bool
isThreadCollapsed threadId (FileState file) =
    Set.member threadId file.collapsed



-- REPLIES


replyDraft : Int -> FileState -> ReplyDraft
replyDraft threadId (FileState file) =
    Dict.get threadId file.replies |> Maybe.withDefault (EditingReply "" Nothing)


changeReply : String -> Int -> String -> Model -> Model
changeReply path threadId body model =
    case replyDraft threadId (fileState path model) of
        EditingReply _ _ ->
            updateFile path (\file -> { file | replies = Dict.insert threadId (EditingReply body Nothing) file.replies }) model

        SendingReply _ _ ->
            model


beginReply : String -> Int -> Model -> Maybe ( Model, ReplySubmission )
beginReply path threadId ((Model details) as model) =
    case replyDraft threadId (fileState path model) of
        EditingReply body _ ->
            if String.trim body == "" then
                Nothing

            else
                let
                    request =
                        ReplyRequest details.session path threadId
                in
                Just
                    ( updateFile path (\file -> { file | replies = Dict.insert threadId (SendingReply request body) file.replies }) model
                    , { request = request, pull = details.pull, commentId = threadId, body = body }
                    )

        SendingReply _ _ ->
            Nothing


replyLoaded : ReplyRequest -> ReviewComment -> Model -> Model
replyLoaded ((ReplyRequest _ path threadId) as request) comment model =
    case replyDraft threadId (fileState path model) of
        SendingReply active _ ->
            if active == request then
                updateFile path
                    (\file -> { file | replies = Dict.remove threadId file.replies, threads = addComment comment file.threads })
                    model

            else
                model

        EditingReply _ _ ->
            model


replyFailed : ReplyRequest -> ApiError -> Model -> Model
replyFailed ((ReplyRequest _ path threadId) as request) error model =
    case replyDraft threadId (fileState path model) of
        SendingReply active body ->
            if active == request then
                updateFile path (\file -> { file | replies = Dict.insert threadId (EditingReply body (Just error)) file.replies }) model

            else
                model

        EditingReply _ _ ->
            model



-- INLINE COMMENTS


inline : FileState -> Inline
inline (FileState file) =
    file.inline


isSubmittingInline : Model -> Bool
isSubmittingInline (Model details) =
    details.files
        |> Dict.values
        |> List.any
            (\(FileState file) ->
                case file.inline of
                    SubmittingInline _ _ _ ->
                        True

                    Composing _ _ _ ->
                        False

                    InlineClosed ->
                        False
            )


{-| Opens the composer at `anchor`, closing any other open composer. Refused
while an inline comment is being submitted.
-}
openInline : Anchor -> Model -> Model
openInline anchor ((Model details) as model) =
    if isSubmittingInline model then
        model

    else
        Model
            { details
                | files =
                    Dict.map
                        (\_ (FileState file) ->
                            case file.inline of
                                Composing _ _ _ ->
                                    FileState { file | inline = InlineClosed }

                                SubmittingInline _ _ _ ->
                                    FileState file

                                InlineClosed ->
                                    FileState file
                        )
                        details.files
            }
            |> updateFile anchor.path (\file -> { file | inline = Composing anchor "" Nothing })


changeInlineBody : String -> String -> Model -> Model
changeInlineBody path body model =
    case inline (fileState path model) of
        Composing anchor _ _ ->
            updateFile path (\file -> { file | inline = Composing anchor body Nothing }) model

        SubmittingInline _ _ _ ->
            model

        InlineClosed ->
            model


cancelInline : String -> Model -> Model
cancelInline path model =
    case inline (fileState path model) of
        Composing _ _ _ ->
            updateFile path (\file -> { file | inline = InlineClosed }) model

        SubmittingInline _ _ _ ->
            model

        InlineClosed ->
            model


submitInline : String -> Model -> Maybe ( Model, InlineSubmission )
submitInline path ((Model details) as model) =
    case inline (fileState path model) of
        Composing anchor body _ ->
            if String.trim body == "" then
                Nothing

            else
                let
                    request =
                        InlineRequest details.session anchor
                in
                Just
                    ( updateFile path (\file -> { file | inline = SubmittingInline request anchor body }) model
                    , { request = request, anchor = anchor, body = body }
                    )

        SubmittingInline _ _ _ ->
            Nothing

        InlineClosed ->
            Nothing


inlineLoaded : InlineRequest -> ReviewComment -> Model -> Model
inlineLoaded ((InlineRequest _ requested) as request) comment model =
    case inline (fileState requested.path model) of
        SubmittingInline active _ _ ->
            if active == request then
                updateFile requested.path (\file -> { file | inline = InlineClosed, threads = addComment comment file.threads }) model

            else
                model

        Composing _ _ _ ->
            model

        InlineClosed ->
            model


inlineFailed : InlineRequest -> ApiError -> Model -> Model
inlineFailed ((InlineRequest _ requested) as request) error model =
    case inline (fileState requested.path model) of
        SubmittingInline active anchor body ->
            if active == request then
                updateFile requested.path (\file -> { file | inline = Composing anchor body (Just error) }) model

            else
                model

        Composing _ _ _ ->
            model

        InlineClosed ->
            model



-- REVIEW SUMMARY


reviewRequestAction : ReviewRequest -> ReviewAction
reviewRequestAction (ReviewRequest _ action) =
    action


reviewDraft : Model -> ReviewDraft
reviewDraft (Model details) =
    details.review


changeReviewBody : String -> Model -> Model
changeReviewBody body ((Model details) as model) =
    case details.review of
        DraftingReview _ _ ->
            Model { details | review = DraftingReview body Nothing }

        SubmittingReview _ _ ->
            model


{-| Starts a review submission. Only approvals may omit the summary, and a
review in flight is never submitted twice.
-}
beginReview : ReviewAction -> Model -> Maybe ( Model, ReviewSubmission )
beginReview action (Model details) =
    case details.review of
        DraftingReview body _ ->
            if action /= ApproveReview && String.trim body == "" then
                Nothing

            else
                let
                    request =
                        ReviewRequest details.session action
                in
                Just
                    ( Model { details | review = SubmittingReview request body }
                    , { request = request, pull = details.pull, action = action, body = body }
                    )

        SubmittingReview _ _ ->
            Nothing


reviewLoaded : ReviewRequest -> ReviewAction -> Model -> Model
reviewLoaded request accepted ((Model details) as model) =
    case details.review of
        SubmittingReview active _ ->
            if active == request then
                Model { details | review = DraftingReview "" (Just (ReviewAccepted accepted)) }

            else
                model

        DraftingReview _ _ ->
            model


reviewFailed : ReviewRequest -> ApiError -> Model -> Model
reviewFailed request error ((Model details) as model) =
    case details.review of
        SubmittingReview active body ->
            if active == request then
                Model { details | review = DraftingReview body (Just (ReviewRejected error)) }

            else
                model

        DraftingReview _ _ ->
            model
