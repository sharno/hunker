module Hunker.View.Time exposing (view)

{-| An instant shown in the viewer's own time zone.

The `<hunker-time>` element in `elm/time.js` formats it in the browser and
keeps relative times current, so Elm holds no clock or zone and a view that
shows times keeps its lazy identity.

-}

import Html exposing (Html)
import Html.Attributes exposing (attribute)
import Time


view : Time.Posix -> Html msg
view instant =
    Html.node "hunker-time" [ attribute "datetime" (String.fromInt (Time.posixToMillis instant)) ] []
