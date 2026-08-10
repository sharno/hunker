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
import Hunker.ApiError as ApiError exposing (ApiError)
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
    | ScrollIntoView String msg
    | After Float msg


type alias HttpRequest msg =
    { method : String
    , url : String
    , body : Http.Body
    , decoder : Decode.Decoder msg
    , onError : ApiError -> msg
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


get : String -> Decode.Decoder msg -> (ApiError -> msg) -> Effect msg
get url decoder onError =
    Request
        { method = "GET"
        , url = url
        , body = Http.emptyBody
        , decoder = decoder
        , onError = onError
        }


send : String -> String -> Http.Body -> Decode.Decoder msg -> (ApiError -> msg) -> Effect msg
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

        ScrollIntoView id message ->
            ScrollIntoView id (transform message)

        After milliseconds message ->
            After milliseconds (transform message)


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

        ScrollIntoView id message ->
            scrollIntoView id
                |> Task.attempt (always message)

        After milliseconds message ->
            Process.sleep milliseconds
                |> Task.perform (always message)


scrollIntoView : String -> Task.Task Browser.Dom.Error ()
scrollIntoView id =
    let
        align element =
            let
                stickyOffset =
                    if element.viewport.width <= 760 then
                        56

                    else
                        120
            in
            Browser.Dom.setViewport element.viewport.x (max 0 (element.element.y - stickyOffset))
    in
    Browser.Dom.getElement id
        |> Task.andThen align
        |> Task.andThen (\_ -> Process.sleep 0)
        |> Task.andThen (\_ -> Browser.Dom.getElement id)
        |> Task.andThen align


expectJson : Decode.Decoder msg -> (ApiError -> msg) -> Http.Expect msg
expectJson decoder onError =
    Http.expectStringResponse
        (\result ->
            case result of
                Ok message ->
                    message

                Err error ->
                    onError error
        )
    <|
        \response ->
            case response of
                Http.BadUrl_ url ->
                    Err (ApiError.transport ("Invalid API URL: " ++ url))

                Http.Timeout_ ->
                    Err (ApiError.transport "The Hunker API timed out.")

                Http.NetworkError_ ->
                    Err (ApiError.transport "Could not reach the local Hunker API.")

                Http.BadStatus_ metadata body ->
                    case Decode.decodeString ApiError.decoder body of
                        Ok apiError ->
                            Err apiError

                        Err _ ->
                            Err
                                (ApiError.unexpectedResponse
                                    ("The Hunker API returned " ++ String.fromInt metadata.statusCode ++ ".")
                                )

                Http.GoodStatus_ _ body ->
                    Decode.decodeString decoder body
                        |> Result.mapError
                            (Decode.errorToString
                                >> (\detail -> ApiError.unexpectedResponse ("The Hunker API returned unexpected data: " ++ detail))
                            )
