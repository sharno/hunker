module Hunker.Effect exposing
    ( Effect(..)
    , HttpRequest
    , batch
    , get
    , map
    , none
    , perform
    , send
    )

import Browser.Dom
import Browser.Navigation as Navigation
import Http
import Json.Decode as Decode
import Process
import Task


type Effect msg
    = None
    | Batch (List (Effect msg))
    | Request (HttpRequest msg)
    | PushUrl String
    | ReplaceUrl String
    | LoadExternal String
    | Focus String msg
    | After Float msg
    | ReadScroll (Float -> msg)


type alias HttpRequest msg =
    { method : String
    , url : String
    , body : Http.Body
    , decoder : Decode.Decoder msg
    , onError : String -> msg
    }


none : Effect msg
none =
    None


batch : List (Effect msg) -> Effect msg
batch effects =
    effects
        |> List.filter
            (\effect ->
                case effect of
                    None ->
                        False

                    _ ->
                        True
            )
        |> (\remaining ->
                case remaining of
                    [] ->
                        None

                    [ only ] ->
                        only

                    _ ->
                        Batch remaining
           )


get : String -> Decode.Decoder msg -> (String -> msg) -> Effect msg
get url decoder onError =
    Request
        { method = "GET"
        , url = url
        , body = Http.emptyBody
        , decoder = decoder
        , onError = onError
        }


send : String -> String -> Http.Body -> Decode.Decoder msg -> (String -> msg) -> Effect msg
send method url body decoder onError =
    Request
        { method = method
        , url = url
        , body = body
        , decoder = decoder
        , onError = onError
        }


map : (a -> b) -> Effect a -> Effect b
map transform effect =
    case effect of
        None ->
            None

        Batch effects ->
            Batch (List.map (map transform) effects)

        Request request ->
            Request
                { method = request.method
                , url = request.url
                , body = request.body
                , decoder = Decode.map transform request.decoder
                , onError = request.onError >> transform
                }

        PushUrl url ->
            PushUrl url

        ReplaceUrl url ->
            ReplaceUrl url

        LoadExternal url ->
            LoadExternal url

        Focus id message ->
            Focus id (transform message)

        After milliseconds message ->
            After milliseconds (transform message)

        ReadScroll toMessage ->
            ReadScroll (toMessage >> transform)


perform : Navigation.Key -> Effect msg -> Cmd msg
perform key effect =
    case effect of
        None ->
            Cmd.none

        Batch effects ->
            Cmd.batch (List.map (perform key) effects)

        Request request ->
            Http.request
                { method = request.method
                , headers = []
                , url = request.url
                , body = request.body
                , expect = expectJson request.decoder request.onError
                , timeout = Nothing
                , tracker = Nothing
                }

        PushUrl url ->
            Navigation.pushUrl key url

        ReplaceUrl url ->
            Navigation.replaceUrl key url

        LoadExternal url ->
            Navigation.load url

        Focus id message ->
            Browser.Dom.focus id
                |> Task.attempt (always message)

        After milliseconds message ->
            Process.sleep milliseconds
                |> Task.perform (always message)

        ReadScroll toMessage ->
            Browser.Dom.getViewport
                |> Task.perform (.viewport >> .y >> toMessage)


expectJson : Decode.Decoder msg -> (String -> msg) -> Http.Expect msg
expectJson decoder onError =
    Http.expectStringResponse
        (\result ->
            case result of
                Ok message ->
                    message

                Err error ->
                    onError (httpError error)
        )
    <|
        \response ->
            case response of
                Http.BadUrl_ url ->
                    Err (Http.BadUrl url)

                Http.Timeout_ ->
                    Err Http.Timeout

                Http.NetworkError_ ->
                    Err Http.NetworkError

                Http.BadStatus_ metadata _ ->
                    Err (Http.BadStatus metadata.statusCode)

                Http.GoodStatus_ _ body ->
                    Decode.decodeString decoder body
                        |> Result.mapError (Decode.errorToString >> Http.BadBody)


httpError : Http.Error -> String
httpError error =
    case error of
        Http.BadUrl url ->
            "Invalid API URL: " ++ url

        Http.Timeout ->
            "The Hunker API timed out."

        Http.NetworkError ->
            "Could not reach the local Hunker API."

        Http.BadStatus status ->
            "The Hunker API returned " ++ String.fromInt status ++ "."

        Http.BadBody detail ->
            "The Hunker API returned unexpected data: " ++ detail
