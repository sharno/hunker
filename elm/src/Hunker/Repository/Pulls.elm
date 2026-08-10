module Hunker.Repository.Pulls exposing
    ( Identity
    , Model
    , failed
    , hasMore
    , identityPage
    , identityRepository
    , identityState
    , init
    , loaded
    , more
    , request
    , rows
    )

import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Repository exposing (PullRequest, PullRequestsPage)
import Hunker.Remote as Remote exposing (Remote(..))
import Hunker.Route exposing (PullRequestState)


type Model
    = Model Details


type alias Details =
    { request : Remote Identity ApiError PullRequestsPage
    , rows : List PullRequest
    , hasMore : Bool
    }


type Identity
    = Identity String PullRequestState Int


init : String -> PullRequestState -> Model
init repository state =
    Model
        { request = Loading (Identity repository state 1)
        , rows = []
        , hasMore = False
        }


request : Model -> Remote Identity ApiError PullRequestsPage
request (Model details) =
    details.request


rows : Model -> List PullRequest
rows (Model details) =
    details.rows


hasMore : Model -> Bool
hasMore (Model details) =
    details.hasMore


loaded : Identity -> PullRequestsPage -> Model -> Model
loaded identity page ((Model details) as model) =
    if Remote.identity details.request /= Just identity then
        model

    else
        Model
            { request = Success identity page
            , rows =
                if page.page == 1 then
                    page.pullRequests

                else
                    details.rows ++ page.pullRequests
            , hasMore = page.hasMore
            }


failed : Identity -> ApiError -> Model -> Model
failed identity error ((Model details) as model) =
    if Remote.identity details.request == Just identity then
        Model { details | request = Failure identity error }

    else
        model


more : Model -> Maybe ( Model, Identity )
more ((Model details) as model) =
    case Remote.identity details.request of
        Just current ->
            let
                next =
                    Identity (identityRepository current) (identityState current) (identityPage current + 1)
            in
            Just ( Model { details | request = Loading next }, next )

        Nothing ->
            Nothing


identityRepository : Identity -> String
identityRepository (Identity repository _ _) =
    repository


identityState : Identity -> PullRequestState
identityState (Identity _ state _) =
    state


identityPage : Identity -> Int
identityPage (Identity _ _ page) =
    page
