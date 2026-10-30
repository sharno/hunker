module Hunker.Repository.Revision exposing (Revision, create, oid, repository)

{-| A repository at one immutable object ID. File and search requests carry
both together so a response can never be attributed to another revision.
-}

import Hunker.Domain.Git exposing (Oid, RepositoryId)


type Revision
    = Revision RepositoryId Oid


create : RepositoryId -> Oid -> Revision
create =
    Revision


repository : Revision -> RepositoryId
repository (Revision value _) =
    value


oid : Revision -> Oid
oid (Revision _ value) =
    value
