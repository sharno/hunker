module Hunker.Repository.Revision exposing (Revision, create, oid, repository)


type Revision
    = Revision Details


type alias Details =
    { repository : String
    , oid : String
    }


create : String -> String -> Revision
create repositoryName objectId =
    Revision
        { repository = repositoryName
        , oid = objectId
        }


repository : Revision -> String
repository (Revision details) =
    details.repository


oid : Revision -> String
oid (Revision details) =
    details.oid
