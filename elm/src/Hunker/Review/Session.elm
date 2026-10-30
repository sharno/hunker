module Hunker.Review.Session exposing (Id, create, diffUrl, headOid)

{-| The identity of one loaded review: the diff it renders at one immutable
head. Full-file, analysis, and collaboration responses carry it so a response
started on one review cannot mutate another.
-}

import Hunker.Domain.Git exposing (Oid)


type Id
    = Id { diffUrl : String, headOid : Oid }


create : String -> Oid -> Id
create url oid =
    Id { diffUrl = url, headOid = oid }


diffUrl : Id -> String
diffUrl (Id details) =
    details.diffUrl


headOid : Id -> Oid
headOid (Id details) =
    details.headOid
