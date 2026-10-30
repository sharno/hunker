module Hunker.Repository.Pulls exposing
    ( Footer(..)
    , Identity
    , Model
    , Status(..)
    , failed
    , identityPage
    , identityRepository
    , identityState
    , init
    , loaded
    , more
    , status
    )

{-| Pages of a repository's pull requests. Only one page loads at a time; a
failed page is retried rather than skipped.
-}

import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Git exposing (RepositoryId)
import Hunker.Domain.Repository exposing (PullRequest, PullRequestState, PullRequestsPage)


type Model
    = Model
        { repository : RepositoryId
        , state : PullRequestState
        , rows : List PullRequest
        , load : Load
        }


type Load
    = Idle { page : Int, hasMore : Bool }
    | LoadingPage Int
    | FailedPage Int ApiError


type Identity
    = Identity RepositoryId PullRequestState Int


type Status
    = FirstLoading
    | FirstFailed ApiError
    | Empty
    | Rows (List PullRequest) Footer


type Footer
    = NoMore
    | CanLoadMore
    | LoadingMore
    | LoadMoreFailed ApiError


init : RepositoryId -> PullRequestState -> ( Model, Identity )
init repository state =
    ( Model { repository = repository, state = state, rows = [], load = LoadingPage 1 }
    , Identity repository state 1
    )


identityRepository : Identity -> RepositoryId
identityRepository (Identity repository _ _) =
    repository


identityState : Identity -> PullRequestState
identityState (Identity _ state _) =
    state


identityPage : Identity -> Int
identityPage (Identity _ _ page) =
    page


isActive : Identity -> Model -> Bool
isActive (Identity repository state page) (Model details) =
    repository == details.repository && state == details.state && details.load == LoadingPage page


loaded : Identity -> PullRequestsPage -> Model -> Model
loaded identity page ((Model details) as model) =
    if isActive identity model then
        Model { details | rows = details.rows ++ page.pullRequests, load = Idle { page = page.page, hasMore = page.hasMore } }

    else
        model


failed : Identity -> ApiError -> Model -> Model
failed identity error ((Model details) as model) =
    if isActive identity model then
        Model { details | load = FailedPage (identityPage identity) error }

    else
        model


more : Model -> Maybe ( Model, Identity )
more (Model details) =
    let
        request page =
            Just ( Model { details | load = LoadingPage page }, Identity details.repository details.state page )
    in
    case details.load of
        Idle { page, hasMore } ->
            if hasMore then
                request (page + 1)

            else
                Nothing

        FailedPage page _ ->
            request page

        LoadingPage _ ->
            Nothing


status : Model -> Status
status (Model details) =
    case ( details.rows, details.load ) of
        ( [], LoadingPage _ ) ->
            FirstLoading

        ( [], FailedPage _ error ) ->
            FirstFailed error

        ( [], Idle _ ) ->
            Empty

        ( rows, Idle { hasMore } ) ->
            Rows rows
                (if hasMore then
                    CanLoadMore

                 else
                    NoMore
                )

        ( rows, LoadingPage _ ) ->
            Rows rows LoadingMore

        ( rows, FailedPage _ error ) ->
            Rows rows (LoadMoreFailed error)
