module MainProgramTest exposing (suite)

import Main
import ProgramTest
import Test exposing (Test, describe, test)
import Test.Html.Selector exposing (text)


suite : Test
suite =
    describe "Hunker Elm program"
        [ test "drives an update branch through the complete program" <|
            \() ->
                ProgramTest.createApplication
                    { init = Main.init
                    , onUrlChange = Main.UrlChanged
                    , onUrlRequest = Main.LinkClicked
                    , update = Main.update
                    , view = Main.view
                    }
                    |> ProgramTest.withBaseUrl "http://localhost:8787/"
                    |> ProgramTest.start ()
                    |> ProgramTest.clickButton "Toggle navigation preview"
                    |> ProgramTest.expectViewHas
                        [ text "Elm update branch is active" ]
        ]
