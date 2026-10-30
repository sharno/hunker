module Hunker.Decode exposing (andMap, enum, tagged)

{-| Decoding helpers shared by every domain module.

`andMap` builds records field by field, so no decoder needs placeholder
values that a later step overwrites.

-}

import Json.Decode as Decode exposing (Decoder)


andMap : Decoder a -> Decoder (a -> b) -> Decoder b
andMap =
    Decode.map2 (|>)


{-| Decodes a string drawn from a closed table of wire values.
-}
enum : String -> List ( String, a ) -> Decoder a
enum description table =
    Decode.string
        |> Decode.andThen
            (\encoded ->
                case lookup encoded table of
                    Just value ->
                        Decode.succeed value

                    Nothing ->
                        Decode.fail ("Unknown " ++ description ++ ": " ++ encoded)
            )


{-| Dispatches on a discriminator field, such as Rust's serde `_tag`.
-}
tagged : String -> String -> List ( String, Decoder a ) -> Decoder a
tagged field description table =
    Decode.field field Decode.string
        |> Decode.andThen
            (\tag ->
                lookup tag table
                    |> Maybe.withDefault (Decode.fail ("Unknown " ++ description ++ ": " ++ tag))
            )


lookup : String -> List ( String, a ) -> Maybe a
lookup key table =
    table
        |> List.filter (Tuple.first >> (==) key)
        |> List.head
        |> Maybe.map Tuple.second
