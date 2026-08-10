module Hunker.ApiError exposing
    ( ApiError
    , Code(..)
    , context
    , decoder
    , message
    , retryable
    , transport
    , unexpectedResponse
    )

import Json.Decode as Decode exposing (Decoder)


type ApiError
    = ApiError
        { code : Code
        , message : String
        , retryable : Bool
        }


type Code
    = BadRequest
    | Unauthorized
    | NotFound
    | Conflict
    | Upstream
    | Internal
    | Transport
    | UnexpectedResponse


decoder : Decoder ApiError
decoder =
    Decode.map3
        (\code detail canRetry ->
            ApiError
                { code = code
                , message = detail
                , retryable = canRetry
                }
        )
        (Decode.field "code" codeDecoder)
        (Decode.field "message" Decode.string)
        (Decode.field "retryable" Decode.bool)


message : ApiError -> String
message (ApiError details) =
    details.message


context : String -> ApiError -> ApiError
context prefix (ApiError details) =
    ApiError { details | message = prefix ++ details.message }


retryable : ApiError -> Bool
retryable (ApiError details) =
    details.retryable


transport : String -> ApiError
transport detail =
    ApiError
        { code = Transport
        , message = detail
        , retryable = True
        }


unexpectedResponse : String -> ApiError
unexpectedResponse detail =
    ApiError
        { code = UnexpectedResponse
        , message = detail
        , retryable = False
        }


codeDecoder : Decoder Code
codeDecoder =
    Decode.string
        |> Decode.andThen
            (\value ->
                case value of
                    "bad_request" ->
                        Decode.succeed BadRequest

                    "unauthorized" ->
                        Decode.succeed Unauthorized

                    "not_found" ->
                        Decode.succeed NotFound

                    "conflict" ->
                        Decode.succeed Conflict

                    "upstream" ->
                        Decode.succeed Upstream

                    "internal" ->
                        Decode.succeed Internal

                    _ ->
                        Decode.fail ("Unknown API error code: " ++ value)
            )
