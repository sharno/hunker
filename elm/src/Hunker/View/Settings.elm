module Hunker.View.Settings exposing (onSelect, options)

{-| Rendering shared by every view that edits a settings select.
-}

import Html exposing (Attribute, Html, option, text)
import Html.Attributes exposing (selected, value)
import Html.Events
import Hunker.Domain.Settings exposing (Change, Choice, Select, Settings)
import Json.Decode as Decode


options : Select a -> (Choice a -> String) -> Settings -> List (Html msg)
options control label settings =
    List.map
        (\choice ->
            option [ value choice.key, selected (control.current settings == choice.value) ] [ text (label choice) ]
        )
        control.choices


{-| Emits the chosen value's change. An unknown key decodes to no message.
-}
onSelect : Select a -> (Change -> msg) -> Attribute msg
onSelect control toMsg =
    Html.Events.on "change"
        (Html.Events.targetValue
            |> Decode.andThen
                (\key ->
                    case List.filter (.key >> (==) key) control.choices of
                        choice :: _ ->
                            Decode.succeed (toMsg (control.change choice.value))

                        [] ->
                            Decode.fail ("Unknown " ++ control.title ++ ": " ++ key)
                )
        )
