module Hunker.Review.Analysis exposing
    ( Identity
    , State(..)
    , complete
    , disabled
    , fail
    , identity
    , inFlight
    , inlineDiff
    , matches
    , snapshot
    )

import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Review exposing (AnalysisSnapshot)
import Hunker.Domain.Settings exposing (InlineDiffMode)


type State
    = Disabled
    | InFlight Identity
    | Failure Identity ApiError
    | Complete Identity AnalysisSnapshot


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


disabled : State
disabled =
    Disabled


inFlight : Identity -> State
inFlight =
    InFlight


complete : Identity -> AnalysisSnapshot -> State -> State
complete requested value state =
    if matches requested state then
        Complete requested value

    else
        state


fail : Identity -> ApiError -> State -> State
fail requested error state =
    if matches requested state then
        Failure requested error

    else
        state


matches : Identity -> State -> Bool
matches requested state =
    case state of
        InFlight current ->
            current == requested

        Failure current _ ->
            current == requested

        Complete current _ ->
            current == requested

        Disabled ->
            False


inlineDiff : Identity -> InlineDiffMode
inlineDiff (Identity details) =
    details.inlineDiff


snapshot : State -> Maybe AnalysisSnapshot
snapshot state =
    case state of
        Complete _ value ->
            Just value

        _ ->
            Nothing
