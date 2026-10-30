module Hunker.Domain.Git exposing
    ( BranchName
    , Oid
    , RepositoryId
    , branchDecoder
    , branchName
    , branchToString
    , oidDecoder
    , oidFromString
    , oidToString
    , repositoryId
    , repositoryName
    , repositoryOwner
    , repositoryToString
    , shortOid
    )

{-| Identities shared by routes, requests, and page state. They are opaque
so a branch, an object ID, and a repository can never be swapped.
-}

import Json.Decode as Decode exposing (Decoder)


type RepositoryId
    = RepositoryId { owner : String, name : String }


type Oid
    = Oid String


type BranchName
    = BranchName String


repositoryId : String -> String -> RepositoryId
repositoryId owner name =
    RepositoryId { owner = owner, name = name }


repositoryOwner : RepositoryId -> String
repositoryOwner (RepositoryId repository) =
    repository.owner


repositoryName : RepositoryId -> String
repositoryName (RepositoryId repository) =
    repository.name


{-| `owner/name`, the form GitHub and the Hunker API use.
-}
repositoryToString : RepositoryId -> String
repositoryToString (RepositoryId repository) =
    repository.owner ++ "/" ++ repository.name


{-| A full SHA-1 or SHA-256 object ID.
-}
oidFromString : String -> Maybe Oid
oidFromString value =
    if List.member (String.length value) [ 40, 64 ] && String.all Char.isHexDigit value then
        Just (Oid (String.toLower value))

    else
        Nothing


oidDecoder : Decoder Oid
oidDecoder =
    Decode.string
        |> Decode.andThen
            (\value ->
                case oidFromString value of
                    Just oid ->
                        Decode.succeed oid

                    Nothing ->
                        Decode.fail ("Not a full Git object ID: " ++ value)
            )


oidToString : Oid -> String
oidToString (Oid value) =
    value


shortOid : Oid -> String
shortOid (Oid value) =
    String.left 8 value


branchName : String -> BranchName
branchName =
    BranchName


branchDecoder : Decoder BranchName
branchDecoder =
    Decode.map BranchName Decode.string


branchToString : BranchName -> String
branchToString (BranchName value) =
    value
