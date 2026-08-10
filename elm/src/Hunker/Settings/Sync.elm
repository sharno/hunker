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

import Hunker.ApiError exposing (ApiError)
import Hunker.Domain.Settings exposing (Settings, SettingsDocument)


type Sync
    = Clean CleanState
    | Saving SavingState
    | Failed FailedState


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


type alias CleanState =
    { revision : Revision
    , document : SettingsDocument
    }


type alias SavingState =
    { revision : Revision
    , sent : Settings
    , desired : Settings
    , configPath : String
    }


type alias FailedState =
    { revision : Revision
    , desired : Settings
    , configPath : String
    , error : ApiError
    }


loaded : SettingsDocument -> Sync
loaded document =
    Clean
        { revision = Revision 0
        , document = document
        }


value : Sync -> Settings
value sync =
    case sync of
        Clean clean ->
            clean.document.settings

        Saving saving ->
            saving.desired

        Failed failure ->
            failure.desired


status : Sync -> Status
status sync =
    case sync of
        Clean clean ->
            Saved clean.document.configPath

        Saving _ ->
            SaveInProgress

        Failed failure ->
            SaveFailed failure.error


queue : Settings -> Sync -> ( Sync, Maybe SaveRequest )
queue desired sync =
    case sync of
        Clean clean ->
            startSave clean.revision clean.document.configPath desired

        Saving saving ->
            ( Saving { saving | desired = desired }, Nothing )

        Failed failure ->
            startSave failure.revision failure.configPath desired


saved : Revision -> SettingsDocument -> Sync -> ( Sync, Maybe SaveRequest )
saved revision document sync =
    case sync of
        Saving saving ->
            if revision /= saving.revision then
                ( sync, Nothing )

            else if saving.desired == saving.sent then
                ( Clean
                    { revision = saving.revision
                    , document = document
                    }
                , Nothing
                )

            else
                startSave saving.revision document.configPath saving.desired

        _ ->
            ( sync, Nothing )


failed : Revision -> ApiError -> Sync -> Sync
failed revision error sync =
    case sync of
        Saving saving ->
            if revision == saving.revision then
                Failed
                    { revision = saving.revision
                    , desired = saving.desired
                    , configPath = saving.configPath
                    , error = error
                    }

            else
                sync

        _ ->
            sync


startSave : Revision -> String -> Settings -> ( Sync, Maybe SaveRequest )
startSave previous configPath desired =
    let
        revision =
            nextRevision previous
    in
    ( Saving
        { revision = revision
        , sent = desired
        , desired = desired
        , configPath = configPath
        }
    , Just
        { revision = revision
        , settings = desired
        }
    )


nextRevision : Revision -> Revision
nextRevision (Revision current) =
    Revision (current + 1)
