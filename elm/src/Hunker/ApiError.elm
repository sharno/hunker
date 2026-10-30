module Hunker.ApiError exposing
    ( ApiError
    , Code(..)
    , decoder
    , isNotFound
    , message
    , transport
    , unexpectedResponse
    )

import Json.Decode as Decode exposing (Decoder)


type ApiError
    = ApiError
        { code : Code
        , message : String
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


{-| Decodes the server's typed error body. A code this client does not know
is kept as `Internal` so the server's message still reaches the user.
-}
decoder : Decoder ApiError
decoder =
    Decode.map2 (\code detail -> ApiError { code = code, message = detail })
        (Decode.field "code" codeDecoder)
        (Decode.field "message" Decode.string)


message : ApiError -> String
message (ApiError details) =
    details.message


isNotFound : ApiError -> Bool
isNotFound (ApiError details) =
    details.code == NotFound


transport : String -> ApiError
transport detail =
    ApiError { code = Transport, message = detail }


unexpectedResponse : String -> ApiError
unexpectedResponse detail =
    ApiError { code = UnexpectedResponse, message = detail }


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
                        Decode.succeed Internal
            )
