module Hunker.Review.Analysis exposing
    ( Identity
    , State
    , Status(..)
    , complete
    , disable
    , fail
    , files
    , identity
    , inFlight
    , init
    , inlineDiff
    , matches
    , snapshot
    , status
    )

import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Review exposing (AnalysisSnapshot)
import Hunker.Domain.Settings exposing (InlineDiffMode)
import Hunker.Review.FileIndex as FileIndex exposing (FileIndex)


type State
    = Disabled FileIndex
    | InFlight Identity FileIndex
    | Failure Identity ApiError FileIndex
    | Complete Identity AnalysisSnapshot FileIndex


type Status
    = AnalysisDisabled
    | AnalysisInFlight
    | AnalysisFailure ApiError
    | AnalysisComplete AnalysisSnapshot


type Identity
    = Identity
        { requestUrl : String
        , baseOid : String
        , headOid : String
        , ignoreWhitespace : Bool
        , semantic : Bool
        , inlineDiff : InlineDiffMode
        }


identity : String -> String -> String -> Bool -> Bool -> InlineDiffMode -> Identity
identity requestUrl baseOid headOid ignoreWhitespace semantic inlineMode =
    Identity
        { requestUrl = requestUrl
        , baseOid = baseOid
        , headOid = headOid
        , ignoreWhitespace = ignoreWhitespace
        , semantic = semantic
        , inlineDiff = inlineMode
        }


init : FileIndex -> State
init files_ =
    Disabled files_


disable : State -> State
disable state =
    Disabled (FileIndex.clearWordRanges (files state))


inFlight : Identity -> State -> State
inFlight requested state =
    InFlight requested (FileIndex.clearWordRanges (files state))


complete : Identity -> AnalysisSnapshot -> State -> State
complete requested value state =
    if matches requested state then
        Complete requested value (FileIndex.withAnalysis value (files state))

    else
        state


fail : Identity -> ApiError -> State -> State
fail requested error state =
    if matches requested state then
        Failure requested error (files state)

    else
        state


matches : Identity -> State -> Bool
matches requested state =
    case state of
        InFlight current _ ->
            current == requested

        Failure current _ _ ->
            current == requested

        Complete current _ _ ->
            current == requested

        Disabled _ ->
            False


inlineDiff : Identity -> InlineDiffMode
inlineDiff (Identity details) =
    details.inlineDiff


snapshot : State -> Maybe AnalysisSnapshot
snapshot state =
    case state of
        Complete _ value _ ->
            Just value

        _ ->
            Nothing


files : State -> FileIndex
files state =
    case state of
        Disabled value ->
            value

        InFlight _ value ->
            value

        Failure _ _ value ->
            value

        Complete _ _ value ->
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

        Complete _ value _ ->
            AnalysisComplete value
