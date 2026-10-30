module Hunker.Effect exposing
    ( Body(..)
    , Effect(..)
    , HttpRequest
    , Method(..)
    , batch
    , get
    , map
    , methodName
    , none
    , perform
    , responseToMessage
    , send
    )

import Browser.Dom
import Browser.Navigation as Navigation
import Http
import Hunker.ApiError as ApiError exposing (ApiError)
import Json.Decode as Decode
import Json.Encode as Encode
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


type Method
    = Get
    | Post
    | Put


{-| Request bodies stay inspectable so tests can assert on payloads.
-}
type Body
    = EmptyBody
    | JsonBody Encode.Value


type alias HttpRequest msg =
    { method : Method
    , url : String
    , body : Body
    , decoder : Decode.Decoder msg
    , onError : ApiError -> msg
    }


none : Effect msg
none =
    None


batch : List (Effect msg) -> Effect msg
batch effects =
    case List.filter isSome effects of
        [] ->
            None

        [ only ] ->
            only

        remaining ->
            Batch remaining


{-| Effects hold functions, so they are matched rather than compared.
-}
isSome : Effect msg -> Bool
isSome effect =
    case effect of
        None ->
            False

        Batch _ ->
            True

        Request _ ->
            True

        PushUrl _ ->
            True

        ReplaceUrl _ ->
            True

        LoadExternal _ ->
            True

        Focus _ _ ->
            True

        ScrollIntoView _ _ ->
            True

        After _ _ ->
            True


get : String -> Decode.Decoder msg -> (ApiError -> msg) -> Effect msg
get url decoder onError =
    Request
        { method = Get
        , url = url
        , body = EmptyBody
        , decoder = decoder
        , onError = onError
        }


send : Method -> String -> Encode.Value -> Decode.Decoder msg -> (ApiError -> msg) -> Effect msg
send method url body decoder onError =
    Request
        { method = method
        , url = url
        , body = JsonBody body
        , decoder = decoder
        , onError = onError
        }


methodName : Method -> String
methodName method =
    case method of
        Get ->
            "GET"

        Post ->
            "POST"

        Put ->
            "PUT"


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
                { method = methodName request.method
                , headers = []
                , url = request.url
                , body =
                    case request.body of
                        EmptyBody ->
                            Http.emptyBody

                        JsonBody value ->
                            Http.jsonBody value
                , expect = Http.expectStringResponse settled (responseToMessage request >> Ok)
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


settled : Result msg msg -> msg
settled result =
    case result of
        Ok message ->
            message

        Err message ->
            message


scrollIntoView : String -> Task.Task Browser.Dom.Error ()
scrollIntoView id =
    let
        align element =
            let
                -- Matches the sticky app bar plus review toolbar heights in
                -- styles.css at the narrow and wide breakpoints.
                stickyOffset =
                    if element.viewport.width <= 760 then
                        56

                    else
                        120
            in
            Browser.Dom.setViewport element.viewport.x (max 0 (element.element.y - stickyOffset))
    in
    -- Align twice: lazily rendered chunks above the target can change height
    -- after the first scroll brings them into view.
    Browser.Dom.getElement id
        |> Task.andThen align
        |> Task.andThen (\_ -> Process.sleep 0)
        |> Task.andThen (\_ -> Browser.Dom.getElement id)
        |> Task.andThen align


{-| Interprets an HTTP response for both the browser runtime and the
simulated test runtime, so non-2xx JSON bodies decode into `ApiError` once.
-}
responseToMessage : HttpRequest msg -> Http.Response String -> msg
responseToMessage request response =
    case response of
        Http.BadUrl_ url ->
            request.onError (ApiError.transport ("Invalid API URL: " ++ url))

        Http.Timeout_ ->
            request.onError (ApiError.transport "The Hunker API timed out.")

        Http.NetworkError_ ->
            request.onError (ApiError.transport "Could not reach the local Hunker API.")

        Http.BadStatus_ metadata body ->
            request.onError
                (Decode.decodeString ApiError.decoder body
                    |> Result.withDefault
                        (ApiError.unexpectedResponse ("The Hunker API returned " ++ String.fromInt metadata.statusCode ++ "."))
                )

        Http.GoodStatus_ _ body ->
            case Decode.decodeString request.decoder body of
                Ok message ->
                    message

                Err error ->
                    request.onError (ApiError.unexpectedResponse ("The Hunker API returned unexpected data: " ++ Decode.errorToString error))
