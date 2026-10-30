module Hunker.Repository.SourceControl exposing
    ( Activity(..)
    , Operation(..)
    , Outcome(..)
    , Snapshot
    , State(..)
    , busy
    , canPull
    , pulledMessage
    )

import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Git exposing (BranchName, RepositoryId)
import Hunker.Domain.Repository exposing (Checkout(..), SourceControlStatus)


{-| `Unavailable` is only the initial discovery failure; a failed operation
on a known checkout keeps its snapshot.
-}
type State
    = Unavailable RepositoryId ApiError
    | Ready Snapshot


type alias Snapshot =
    { repository : RepositoryId
    , status : SourceControlStatus
    , activity : Activity
    }


type Operation
    = RefreshOperation
    | SwitchOperation BranchName
    | PullOperation


type Outcome
    = Refreshed
    | Switched BranchName
    | Pulled Int


type Activity
    = Idle
    | Refreshing
    | BranchSwitching BranchName
    | PullInFlight
    | PullSynchronizing Int
    | Succeeded Outcome
    | Failed Operation ApiError


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

        Failed _ _ ->
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
