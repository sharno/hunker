module Hunker.Settings.Sync exposing
    ( Revision
    , SaveRequest
    , Status(..)
    , Sync
    , failed
    , loaded
    , queue
    , saved
    , status
    , value
    )

{-| Serialized, coalesced persistence of the one shared settings document.

At most one save is in flight. Changes made while it runs are coalesced into
the next save, and a response only settles the save it answers.

-}

import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Settings exposing (Settings, SettingsDocument)


type Sync
    = Sync
        { configPath : String
        , revision : Revision
        , phase : Phase
        }


type Phase
    = Clean Settings
    | Saving { sent : Settings, desired : Settings }
    | Failed { desired : Settings, error : ApiError }


type Revision
    = Revision Int


type alias SaveRequest =
    { revision : Revision
    , settings : Settings
    }


type Status
    = Saved String
    | SaveInProgress
    | SaveFailed ApiError


loaded : SettingsDocument -> Sync
loaded document =
    Sync { configPath = document.configPath, revision = Revision 0, phase = Clean document.settings }


value : Sync -> Settings
value (Sync sync) =
    case sync.phase of
        Clean settings ->
            settings

        Saving saving ->
            saving.desired

        Failed failure ->
            failure.desired


status : Sync -> Status
status (Sync sync) =
    case sync.phase of
        Clean _ ->
            Saved sync.configPath

        Saving _ ->
            SaveInProgress

        Failed failure ->
            SaveFailed failure.error


{-| Requests `desired`. Nothing is sent when it is already the current value,
and a request made during a save waits for that save to finish.
-}
queue : Settings -> Sync -> ( Sync, Maybe SaveRequest )
queue desired ((Sync sync) as current) =
    case sync.phase of
        Clean settings ->
            if settings == desired then
                ( current, Nothing )

            else
                startSave desired current

        Saving saving ->
            ( Sync { sync | phase = Saving { saving | desired = desired } }, Nothing )

        Failed _ ->
            startSave desired current


saved : Revision -> SettingsDocument -> Sync -> ( Sync, Maybe SaveRequest )
saved revision document ((Sync sync) as current) =
    case sync.phase of
        Saving saving ->
            if revision /= sync.revision then
                ( current, Nothing )

            else if saving.desired == saving.sent then
                ( Sync { sync | configPath = document.configPath, phase = Clean document.settings }, Nothing )

            else
                startSave saving.desired (Sync { sync | configPath = document.configPath })

        -- Only an in-flight save can complete.
        Clean _ ->
            ( current, Nothing )

        Failed _ ->
            ( current, Nothing )


failed : Revision -> ApiError -> Sync -> Sync
failed revision error ((Sync sync) as current) =
    case sync.phase of
        Saving saving ->
            if revision == sync.revision then
                Sync { sync | phase = Failed { desired = saving.desired, error = error } }

            else
                current

        -- Only an in-flight save can fail.
        Clean _ ->
            current

        Failed _ ->
            current


startSave : Settings -> Sync -> ( Sync, Maybe SaveRequest )
startSave desired (Sync sync) =
    let
        (Revision previous) =
            sync.revision

        revision =
            Revision (previous + 1)
    in
    ( Sync { sync | revision = revision, phase = Saving { sent = desired, desired = desired } }
    , Just { revision = revision, settings = desired }
    )
