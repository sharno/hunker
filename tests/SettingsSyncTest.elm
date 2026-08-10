module SettingsSyncTest exposing (suite)

import Expect
import Hunker.ApiError as ApiError
import Hunker.Domain.Settings as Settings exposing (Settings, SettingsDocument)
import Hunker.Settings.Sync as Sync
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "settings synchronization typestate"
        [ test "coalesces desired settings without changing the in-flight document" <|
            \() ->
                let
                    defaults =
                        Settings.default

                    original =
                        document defaults

                    semanticOff =
                        { defaults | semantic = False }

                    latest =
                        { semanticOff | ignoreWhitespace = False }

                    ( saving, firstRequest ) =
                        Sync.queue semanticOff (Sync.loaded original)

                    ( queued, duplicateRequest ) =
                        Sync.queue latest saving

                    nextRequest =
                        firstRequest
                            |> Maybe.map
                                (\request ->
                                    Sync.saved request.revision (document semanticOff) queued
                                        |> Tuple.second
                                )
                            |> Maybe.withDefault Nothing
                in
                Expect.all
                    [ \_ -> Expect.equal latest (Sync.value queued)
                    , \_ -> Expect.equal Nothing duplicateRequest
                    , \_ -> Expect.equal (Just latest) (Maybe.map .settings nextRequest)
                    ]
                    ()
        , test "ignores a stale completion after starting the queued save" <|
            \() ->
                let
                    defaults =
                        Settings.default

                    first =
                        { defaults | semantic = False }

                    second =
                        { first | ignoreWhitespace = False }

                    ( savingFirst, firstRequest ) =
                        Sync.queue first (Sync.loaded (document defaults))

                    ( queued, _ ) =
                        Sync.queue second savingFirst

                    ( savingSecond, secondRequest ) =
                        firstRequest
                            |> Maybe.map (\request -> Sync.saved request.revision (document first) queued)
                            |> Maybe.withDefault ( queued, Nothing )

                    afterStale =
                        case firstRequest of
                            Just request ->
                                Sync.saved request.revision (document first) savingSecond |> Tuple.first

                            Nothing ->
                                savingSecond
                in
                Expect.all
                    [ \_ -> Expect.equal second (Sync.value afterStale)
                    , \_ -> Expect.equal (Just second) (Maybe.map .settings secondRequest)
                    ]
                    ()
        , test "retains the desired settings and typed error after a failed save" <|
            \() ->
                let
                    defaults =
                        Settings.default

                    desired =
                        { defaults | syntaxHighlighting = False }

                    error =
                        ApiError.transport "settings disk unavailable"

                    ( saving, request ) =
                        Sync.queue desired (Sync.loaded (document defaults))

                    failed =
                        request
                            |> Maybe.map (\save -> Sync.failed save.revision error saving)
                            |> Maybe.withDefault saving
                in
                Expect.all
                    [ \_ -> Expect.equal desired (Sync.value failed)
                    , \_ ->
                        case Sync.status failed of
                            Sync.SaveFailed actual ->
                                Expect.equal "settings disk unavailable" (ApiError.message actual)

                            _ ->
                                Expect.fail "Expected a failed settings state"
                    ]
                    ()
        ]


document : Settings -> SettingsDocument
document settings =
    { settings = settings
    , configPath = "/tmp/hunker/settings.json"
    }
