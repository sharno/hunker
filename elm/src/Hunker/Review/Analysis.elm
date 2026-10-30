module Hunker.Review.Analysis exposing
    ( Identity
    , State
    , Status(..)
    , begin
    , complete
    , fail
    , files
    , init
    , status
    )

{-| Review analysis owns the prepared `FileIndex` it decorates, so a snapshot
and its word ranges cannot update independently.
-}

import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Review exposing (AnalysisSnapshot)
import Hunker.Domain.Settings as Settings exposing (AnalysisOptions)
import Hunker.Review.FileIndex as FileIndex exposing (FileIndex)
import Hunker.Review.Session as Session


type State
    = Disabled FileIndex
    | InFlight Identity FileIndex
    | Failure Identity ApiError FileIndex
    | Complete Identity FileIndex


type Status
    = AnalysisDisabled
    | AnalysisInFlight
    | AnalysisFailure ApiError
    | AnalysisComplete


type Identity
    = Identity Session.Id AnalysisOptions


init : FileIndex -> State
init =
    Disabled


{-| Starts the analysis `options` select, or disables analysis when they
request nothing. Returns the request identity to fetch, if any.
-}
begin : Session.Id -> AnalysisOptions -> State -> ( State, Maybe Identity )
begin session options state =
    let
        cleared =
            FileIndex.clearAnalysis (files state)
    in
    if Settings.requestsAnalysis options then
        let
            requested =
                Identity session options
        in
        ( InFlight requested cleared, Just requested )

    else
        ( Disabled cleared, Nothing )


complete : Identity -> AnalysisSnapshot -> State -> State
complete requested value state =
    case state of
        InFlight current index ->
            if current == requested then
                Complete requested (FileIndex.withAnalysis value index)

            else
                state

        Disabled _ ->
            state

        Failure _ _ _ ->
            state

        Complete _ _ ->
            state


fail : Identity -> ApiError -> State -> State
fail requested error state =
    case state of
        InFlight current index ->
            if current == requested then
                Failure requested error index

            else
                state

        Disabled _ ->
            state

        Failure _ _ _ ->
            state

        Complete _ _ ->
            state


files : State -> FileIndex
files state =
    case state of
        Disabled value ->
            value

        InFlight _ value ->
            value

        Failure _ _ value ->
            value

        Complete _ value ->
            value


status : State -> Status
status state =
    case state of
        Disabled _ ->
            AnalysisDisabled

        InFlight _ _ ->
            AnalysisInFlight

        Failure _ error _ ->
            AnalysisFailure error

        Complete _ _ ->
            AnalysisComplete
