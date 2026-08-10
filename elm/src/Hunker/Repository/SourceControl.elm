module Hunker.Repository.SourceControl exposing
    ( Activity(..)
    , Snapshot
    , State(..)
    , busy
    , canPull
    , pulledMessage
    )

import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Repository exposing (Checkout(..), SourceControlStatus)


type State
    = Loading String
    | Unavailable String ApiError
    | Ready Snapshot


type alias Snapshot =
    { repository : String
    , status : SourceControlStatus
    , activity : Activity
    }


type Activity
    = Idle
    | Refreshing
    | BranchSwitching String
    | PullInFlight
    | PullSynchronizing Int
    | Succeeded String


busy : Activity -> Bool
busy activity =
    case activity of
        Refreshing ->
            True

        BranchSwitching _ ->
            True

        PullInFlight ->
            True

        PullSynchronizing _ ->
            True

        Idle ->
            False

        Succeeded _ ->
            False


canPull : SourceControlStatus -> Bool
canPull status =
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
