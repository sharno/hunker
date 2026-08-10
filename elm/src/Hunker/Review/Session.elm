module Hunker.Review.Session exposing
    ( Id
    , create
    , headOid
    , pullUrl
    , requestUrl
    )


type Id
    = Id
        { requestUrl : String
        , pullUrl : String
        , headOid : String
        }


create : String -> String -> String -> Id
create currentRequestUrl currentPullUrl currentHeadOid =
    Id
        { requestUrl = currentRequestUrl
        , pullUrl = currentPullUrl
        , headOid = currentHeadOid
        }


requestUrl : Id -> String
requestUrl (Id details) =
    details.requestUrl


pullUrl : Id -> String
pullUrl (Id details) =
    details.pullUrl


headOid : Id -> String
headOid (Id details) =
    details.headOid
