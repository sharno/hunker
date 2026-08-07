module Hunker.Route exposing
    ( RepositoryLocation
    , RepositoryTab(..)
    , ReviewLocation
    , ReviewTab(..)
    , ReviewTarget(..)
    , Route(..)
    , fromGithubString
    , fromUrl
    , githubUrl
    , isPullRequest
    , repositoryName
    , toPath
    )

import Url exposing (Url)


type Route
    = Home
    | Settings
    | Repository RepositoryLocation
    | Review ReviewLocation
    | NotFound String


type RepositoryTab
    = RepositoryFiles
    | RepositoryPulls
    | RepositoryCommits


type alias RepositoryLocation =
    { owner : String
    , repository : String
    , tab : RepositoryTab
    , ref : Maybe String
    , path : Maybe String
    , query : String
    , searchMode : String
    , pullState : String
    }


type ReviewTab
    = ReviewFiles
    | ReviewCommits


type ReviewTarget
    = PullRequest String String Int
    | Compare String String String
    | Commit String String String


type alias ReviewLocation =
    { target : ReviewTarget
    , tab : ReviewTab
    , path : Maybe String
    , commit : Maybe String
    }


fromUrl : Url -> Route
fromUrl url =
    fromPath url.path url.query


fromGithubString : String -> Result String Route
fromGithubString raw =
    let
        normalized =
            if String.startsWith "github.com/" raw then
                "https://" ++ raw

            else
                raw
    in
    case Url.fromString normalized of
        Nothing ->
            Err "Paste a complete GitHub repository, pull request, compare, commit, or file URL."

        Just url ->
            if url.host == "github.com" || url.host == "www.github.com" || url.host == "localhost" || url.host == "127.0.0.1" then
                case fromPath url.path url.query of
                    NotFound _ ->
                        Err "Hunker does not have a focused view for that GitHub URL."

                    route ->
                        Ok route

            else
                Err "Hunker currently accepts github.com or Hunker URLs."


fromPath : String -> Maybe String -> Route
fromPath path maybeQuery =
    case decodedSegments path of
        Nothing ->
            NotFound path

        Just segments ->
            parseSegments segments (queryOptions maybeQuery) path


parseSegments : List String -> QueryOptions -> String -> Route
parseSegments segments options originalPath =
    case segments of
        [] ->
            Home

        [ "settings" ] ->
            Settings

        [ "repo", owner, repository ] ->
            repositoryRoute owner repository RepositoryFiles Nothing Nothing options

        owner :: repository :: "pull" :: number :: rest ->
            case String.toInt number of
                Nothing ->
                    NotFound originalPath

                Just pullNumber ->
                    parsePull owner repository pullNumber rest options

        [ owner, repository, "compare", range ] ->
            Review
                { target = Compare owner repository range
                , tab = ReviewFiles
                , path = nonEmpty options.file
                , commit = Nothing
                }

        [ owner, repository, "commit", sha ] ->
            Review
                { target = Commit owner repository sha
                , tab = ReviewFiles
                , path = nonEmpty options.file
                , commit = Nothing
                }

        owner :: repository :: "blob" :: reference :: filePath ->
            if List.isEmpty filePath then
                NotFound originalPath

            else
                repositoryRoute owner repository RepositoryFiles (Just reference) (Just (String.join "/" filePath)) options

        [ owner, repository, "pulls" ] ->
            repositoryRoute owner repository RepositoryPulls Nothing Nothing options

        [ owner, repository, "commits" ] ->
            repositoryRoute owner repository RepositoryCommits Nothing Nothing options

        owner :: repository :: "commits" :: reference ->
            repositoryRoute owner repository RepositoryCommits (Just (String.join "/" reference)) Nothing options

        [ owner, repository ] ->
            repositoryRoute owner repository RepositoryFiles Nothing (nonEmpty options.file) options

        _ ->
            NotFound originalPath


parsePull : String -> String -> Int -> List String -> QueryOptions -> Route
parsePull owner repository number rest options =
    let
        base tab path commit =
            Review
                { target = PullRequest owner repository number
                , tab = tab
                , path = path
                , commit = commit
                }
    in
    case rest of
        [] ->
            base ReviewFiles (nonEmpty options.file) Nothing

        [ "files" ] ->
            base ReviewFiles (nonEmpty options.file) Nothing

        "files" :: path ->
            base ReviewFiles (Just (String.join "/" path)) Nothing

        [ "commits" ] ->
            base ReviewCommits Nothing Nothing

        [ "commits", sha ] ->
            base ReviewCommits Nothing (Just sha)

        _ ->
            NotFound ("/" ++ String.join "/" (owner :: repository :: "pull" :: String.fromInt number :: rest))


repositoryRoute : String -> String -> RepositoryTab -> Maybe String -> Maybe String -> QueryOptions -> Route
repositoryRoute owner repository tab reference path options =
    Repository
        { owner = owner
        , repository = repository
        , tab = tab
        , ref = reference
        , path = path
        , query = options.query
        , searchMode = options.searchMode
        , pullState = options.pullState
        }


toPath : Route -> String
toPath route =
    case route of
        Home ->
            "/"

        Settings ->
            "/settings"

        NotFound path ->
            path

        Repository location ->
            repositoryPath location

        Review location ->
            reviewPath location


repositoryPath : RepositoryLocation -> String
repositoryPath location =
    let
        prefix =
            "/" ++ encode location.owner ++ "/" ++ encode location.repository

        path =
            case ( location.tab, location.path, location.ref ) of
                ( RepositoryFiles, Just filePath, maybeReference ) ->
                    prefix ++ "/blob/" ++ encode (Maybe.withDefault "HEAD" maybeReference) ++ "/" ++ encodePath filePath

                ( RepositoryPulls, _, _ ) ->
                    prefix ++ "/pulls"

                ( RepositoryCommits, _, Just reference ) ->
                    prefix ++ "/commits/" ++ encodePath reference

                ( RepositoryCommits, _, Nothing ) ->
                    prefix ++ "/commits"

                _ ->
                    prefix

        query =
            repositoryQuery location
    in
    path
        ++ (if query == "" then
                ""

            else
                "?" ++ query
           )


repositoryQuery : RepositoryLocation -> String
repositoryQuery location =
    [ if location.tab == RepositoryFiles && location.query /= "" then
        Just ("q=" ++ encode location.query)

      else
        Nothing
    , if location.tab == RepositoryFiles && location.searchMode /= "literal" then
        Just ("search=" ++ encode location.searchMode)

      else
        Nothing
    , if location.tab == RepositoryPulls && location.pullState /= "open" then
        Just ("state=" ++ encode location.pullState)

      else
        Nothing
    ]
        |> List.filterMap identity
        |> String.join "&"


reviewPath : ReviewLocation -> String
reviewPath location =
    let
        prefix =
            case location.target of
                PullRequest owner repository number ->
                    "/" ++ encode owner ++ "/" ++ encode repository ++ "/pull/" ++ String.fromInt number

                Compare owner repository range ->
                    "/" ++ encode owner ++ "/" ++ encode repository ++ "/compare/" ++ encode range

                Commit owner repository sha ->
                    "/" ++ encode owner ++ "/" ++ encode repository ++ "/commit/" ++ encode sha
    in
    case location.target of
        PullRequest _ _ _ ->
            case ( location.tab, location.commit, location.path ) of
                ( ReviewCommits, Just sha, _ ) ->
                    prefix ++ "/commits/" ++ encode sha

                ( ReviewCommits, Nothing, _ ) ->
                    prefix ++ "/commits"

                ( ReviewFiles, _, Just path ) ->
                    prefix ++ "/files/" ++ encodePath path

                _ ->
                    prefix ++ "/files"

        _ ->
            prefix


githubUrl : ReviewTarget -> String
githubUrl target =
    case target of
        PullRequest owner repository number ->
            "https://github.com/" ++ owner ++ "/" ++ repository ++ "/pull/" ++ String.fromInt number

        Compare owner repository range ->
            "https://github.com/" ++ owner ++ "/" ++ repository ++ "/compare/" ++ range

        Commit owner repository sha ->
            "https://github.com/" ++ owner ++ "/" ++ repository ++ "/commit/" ++ sha


repositoryName : ReviewTarget -> String
repositoryName target =
    case target of
        PullRequest owner repository _ ->
            owner ++ "/" ++ repository

        Compare owner repository _ ->
            owner ++ "/" ++ repository

        Commit owner repository _ ->
            owner ++ "/" ++ repository


isPullRequest : ReviewTarget -> Bool
isPullRequest target =
    case target of
        PullRequest _ _ _ ->
            True

        _ ->
            False


decodedSegments : String -> Maybe (List String)
decodedSegments path =
    path
        |> String.split "/"
        |> List.filter ((/=) "")
        |> List.map Url.percentDecode
        |> sequenceMaybe


sequenceMaybe : List (Maybe value) -> Maybe (List value)
sequenceMaybe values =
    List.foldr (Maybe.map2 (::)) (Just []) values


encode : String -> String
encode =
    Url.percentEncode


encodePath : String -> String
encodePath path =
    path
        |> String.split "/"
        |> List.map encode
        |> String.join "/"


nonEmpty : String -> Maybe String
nonEmpty value =
    if value == "" then
        Nothing

    else
        Just value


type alias QueryOptions =
    { query : String
    , searchMode : String
    , pullState : String
    , file : String
    }


queryOptions : Maybe String -> QueryOptions
queryOptions query =
    let
        pairs =
            query
                |> Maybe.withDefault ""
                |> String.split "&"
                |> List.filterMap
                    (\part ->
                        case String.split "=" part of
                            key :: valueParts ->
                                Just
                                    ( Url.percentDecode key |> Maybe.withDefault key
                                    , Url.percentDecode (String.join "=" valueParts) |> Maybe.withDefault (String.join "=" valueParts)
                                    )

                            [] ->
                                Nothing
                    )

        find key fallback =
            pairs
                |> List.filter (Tuple.first >> (==) key)
                |> List.head
                |> Maybe.map Tuple.second
                |> Maybe.withDefault fallback

        mode =
            find "search" "literal"

        state =
            find "state" "open"
    in
    { query = find "q" ""
    , searchMode =
        if List.member mode [ "literal", "regex", "fuzzy" ] then
            mode

        else
            "literal"
    , pullState =
        if List.member state [ "open", "closed", "all" ] then
            state

        else
            "open"
    , file = find "file" ""
    }
