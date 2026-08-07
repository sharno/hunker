module Hunker.Remote exposing
    ( Remote(..)
    , data
    , failure
    , identity
    , isLoading
    , loading
    , map
    , notAsked
    , success
    )


type Remote identity error value
    = NotAsked
    | Loading identity
    | Failure identity error
    | Success identity value


notAsked : Remote identity error value
notAsked =
    NotAsked


loading : identity -> Remote identity error value
loading =
    Loading


failure : identity -> error -> Remote identity error value
failure =
    Failure


success : identity -> value -> Remote identity error value
success =
    Success


identity : Remote identity error value -> Maybe identity
identity remote =
    case remote of
        NotAsked ->
            Nothing

        Loading request ->
            Just request

        Failure request _ ->
            Just request

        Success request _ ->
            Just request


data : Remote identity error value -> Maybe value
data remote =
    case remote of
        Success _ value ->
            Just value

        _ ->
            Nothing


isLoading : Remote identity error value -> Bool
isLoading remote =
    case remote of
        Loading _ ->
            True

        _ ->
            False


map : (a -> b) -> Remote identity error a -> Remote identity error b
map transform remote =
    case remote of
        NotAsked ->
            NotAsked

        Loading request ->
            Loading request

        Failure request error ->
            Failure request error

        Success request value ->
            Success request (transform value)
