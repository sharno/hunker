module Hunker.Remote exposing (Remote(..))

{-| An asynchronous resource. The request identity lives inside the loading,
failed, and loaded states so a response can be matched to the request that
is still active.
-}


type Remote identity error value
    = NotAsked
    | Loading identity
    | Failure identity error
    | Success identity value
