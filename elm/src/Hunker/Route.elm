module Hunker.Route exposing
    ( FilesLocation
    , GithubInputError(..)
    , PullRequestRef
    , PullView(..)
    , RepositoryLocation
    , RepositoryView(..)
    , ReviewLocation
    , ReviewSubject(..)
    , Route(..)
    , Search(..)
    , blobUrl
    , diffUrl
    , fromGithubString
    , fromUrl
    , pullRequest
    , pullRequestUrl
    , reviewLabel
    , sameDiff
    , selectFile
    , selectedPath
    , toPath
    )

import Hunker.Domain.Git as Git exposing (Oid, RepositoryId)
import Hunker.Domain.Repository as Repository exposing (PullRequestState(..), SearchMode(..))
import Url exposing (Url)
import Url.Builder


type Route
    = Home
    | Settings
    | Repository RepositoryLocation
    | Review ReviewLocation
    | NotFound String


type alias RepositoryLocation =
    { repository : RepositoryId
    , view : RepositoryView
    }


{-| Each repository tab owns only the location fields it can use.
-}
type RepositoryView
    = FilesView FilesLocation
    | CommitsView (Maybe String)
    | PullsView PullRequestState


type alias FilesLocation =
    { ref : Maybe String
    , path : Maybe String
    , search : Search
    }


type Search
    = NoSearch
    | Search String SearchMode


type alias ReviewLocation =
    { repository : RepositoryId
    , subject : ReviewSubject
    }


{-| Only pull requests have commit and collaboration views.
-}
type ReviewSubject
    = PullRequest Int PullView
    | Compare String (Maybe String)
    | Commit String (Maybe String)


type PullView
    = PullFiles (Maybe String)
    | PullCommits
    | PullCommitFiles String (Maybe String)


type alias PullRequestRef =
    { repository : RepositoryId
    , number : Int
    }


type GithubInputError
    = UnparseableUrl
    | ForeignHost
    | UnsupportedLocation


fromUrl : Url -> Route
fromUrl url =
    fromPath url.path url.query


{-| Accepts GitHub (or Hunker) URLs for repositories and reviews only.
-}
fromGithubString : String -> Result GithubInputError Route
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
            Err UnparseableUrl

        Just url ->
            if List.member url.host [ "github.com", "www.github.com", "localhost", "127.0.0.1" ] then
                case fromPath url.path url.query of
                    (Repository _) as route ->
                        Ok route

                    (Review _) as route ->
                        Ok route

                    Home ->
                        Err UnsupportedLocation

                    Settings ->
                        Err UnsupportedLocation

                    NotFound _ ->
                        Err UnsupportedLocation

            else
                Err ForeignHost


fromPath : String -> Maybe String -> Route
fromPath path maybeQuery =
    case decodedSegments path of
        Nothing ->
            NotFound path

        Just segments ->
            parseSegments segments (queryOptions maybeQuery)
                |> Maybe.withDefault (NotFound path)


parseSegments : List String -> QueryOptions -> Maybe Route
parseSegments segments options =
    let
        repository owner name view =
            Just (Repository { repository = Git.repositoryId owner name, view = view })

        review owner name subject =
            Just (Review { repository = Git.repositoryId owner name, subject = subject })

        files ref path =
            FilesView { ref = ref, path = path, search = options.search }
    in
    case segments of
        [] ->
            Just Home

        [ "settings" ] ->
            Just Settings

        [ "repo", owner, name ] ->
            repository owner name (files Nothing Nothing)

        owner :: name :: "pull" :: number :: rest ->
            String.toInt number
                |> Maybe.andThen (\pull -> parsePull rest options |> Maybe.map (PullRequest pull))
                |> Maybe.andThen (review owner name)

        [ owner, name, "compare", range ] ->
            review owner name (Compare range options.file)

        [ owner, name, "commit", sha ] ->
            review owner name (Commit sha options.file)

        owner :: name :: "blob" :: reference :: ((_ :: _) as filePath) ->
            repository owner name (files (Just reference) (Just (String.join "/" filePath)))

        [ owner, name, "tree", reference ] ->
            repository owner name (files (Just reference) Nothing)

        [ owner, name, "pulls" ] ->
            repository owner name (PullsView options.pullState)

        [ owner, name, "commits" ] ->
            repository owner name (CommitsView Nothing)

        owner :: name :: "commits" :: ((_ :: _) as reference) ->
            repository owner name (CommitsView (Just (String.join "/" reference)))

        [ owner, name ] ->
            repository owner name (files Nothing options.file)

        _ ->
            Nothing


parsePull : List String -> QueryOptions -> Maybe PullView
parsePull rest options =
    case rest of
        [] ->
            Just (PullFiles options.file)

        [ "files" ] ->
            Just (PullFiles options.file)

        "files" :: ((_ :: _) as path) ->
            Just (PullFiles (Just (String.join "/" path)))

        [ "commits" ] ->
            Just PullCommits

        [ "commits", sha ] ->
            Just (PullCommitFiles sha options.file)

        _ ->
            Nothing


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
            repositoryPrefix location.repository
    in
    case location.view of
        FilesView files ->
            (case ( files.path, files.ref ) of
                ( Just filePath, reference ) ->
                    prefix ++ "/blob/" ++ Url.percentEncode (Maybe.withDefault "HEAD" reference) ++ "/" ++ encodePath filePath

                ( Nothing, Just reference ) ->
                    prefix ++ "/tree/" ++ Url.percentEncode reference

                ( Nothing, Nothing ) ->
                    prefix
            )
                ++ Url.Builder.toQuery (searchQuery files.search)

        CommitsView Nothing ->
            prefix ++ "/commits"

        CommitsView (Just reference) ->
            prefix ++ "/commits/" ++ encodePath reference

        PullsView OpenPulls ->
            prefix ++ "/pulls"

        PullsView state ->
            prefix ++ "/pulls" ++ Url.Builder.toQuery [ Url.Builder.string "state" (Repository.pullRequestStateToString state) ]


searchQuery : Search -> List Url.Builder.QueryParameter
searchQuery search =
    case search of
        NoSearch ->
            []

        Search query LiteralSearch ->
            [ Url.Builder.string "q" query ]

        Search query mode ->
            [ Url.Builder.string "q" query, Url.Builder.string "search" (Repository.searchModeToString mode) ]


reviewPath : ReviewLocation -> String
reviewPath location =
    let
        prefix =
            repositoryPrefix location.repository

        withFile file path =
            path ++ Url.Builder.toQuery (List.map (Url.Builder.string "file") (maybeToList file))
    in
    case location.subject of
        PullRequest number view ->
            let
                pull =
                    prefix ++ "/pull/" ++ String.fromInt number
            in
            case view of
                PullFiles Nothing ->
                    pull ++ "/files"

                PullFiles (Just path) ->
                    pull ++ "/files/" ++ encodePath path

                PullCommits ->
                    pull ++ "/commits"

                PullCommitFiles sha file ->
                    withFile file (pull ++ "/commits/" ++ Url.percentEncode sha)

        Compare range file ->
            withFile file (prefix ++ "/compare/" ++ Url.percentEncode range)

        Commit sha file ->
            withFile file (prefix ++ "/commit/" ++ Url.percentEncode sha)


repositoryPrefix : RepositoryId -> String
repositoryPrefix repository =
    "/" ++ Url.percentEncode (Git.repositoryOwner repository) ++ "/" ++ Url.percentEncode (Git.repositoryName repository)


{-| The GitHub URL whose immutable diff a review location renders.
-}
diffUrl : ReviewLocation -> String
diffUrl location =
    let
        repository =
            "https://github.com/" ++ Git.repositoryToString location.repository
    in
    case location.subject of
        PullRequest _ (PullCommitFiles sha _) ->
            repository ++ "/commit/" ++ sha

        PullRequest number _ ->
            repository ++ "/pull/" ++ String.fromInt number

        Compare range _ ->
            repository ++ "/compare/" ++ range

        Commit sha _ ->
            repository ++ "/commit/" ++ sha


{-| Two locations that load the same immutable diff differ only in selection.
-}
sameDiff : ReviewLocation -> ReviewLocation -> Bool
sameDiff first second =
    diffUrl first == diffUrl second


pullRequest : ReviewLocation -> Maybe PullRequestRef
pullRequest location =
    case location.subject of
        PullRequest number _ ->
            Just { repository = location.repository, number = number }

        Compare _ _ ->
            Nothing

        Commit _ _ ->
            Nothing


pullRequestUrl : PullRequestRef -> String
pullRequestUrl pull =
    "https://github.com/" ++ Git.repositoryToString pull.repository ++ "/pull/" ++ String.fromInt pull.number


blobUrl : RepositoryId -> Oid -> String -> String
blobUrl repository oid path =
    "https://github.com/" ++ Git.repositoryToString repository ++ "/blob/" ++ Git.oidToString oid ++ "/" ++ encodePath path


reviewLabel : ReviewLocation -> String
reviewLabel location =
    case location.subject of
        PullRequest number _ ->
            "#" ++ String.fromInt number

        Compare range _ ->
            range

        Commit sha _ ->
            String.left 7 sha


selectedPath : ReviewLocation -> Maybe String
selectedPath location =
    case location.subject of
        PullRequest _ (PullFiles path) ->
            path

        PullRequest _ PullCommits ->
            Nothing

        PullRequest _ (PullCommitFiles _ path) ->
            path

        Compare _ path ->
            path

        Commit _ path ->
            path


{-| Selects a file within the diff the location already shows. The pull
request commit list has no diff, so selecting there opens the files view.
-}
selectFile : String -> ReviewLocation -> ReviewLocation
selectFile path location =
    let
        selected =
            Just path
    in
    { location
        | subject =
            case location.subject of
                PullRequest number (PullFiles _) ->
                    PullRequest number (PullFiles selected)

                PullRequest number PullCommits ->
                    PullRequest number (PullFiles selected)

                PullRequest number (PullCommitFiles sha _) ->
                    PullRequest number (PullCommitFiles sha selected)

                Compare range _ ->
                    Compare range selected

                Commit sha _ ->
                    Commit sha selected
    }


decodedSegments : String -> Maybe (List String)
decodedSegments path =
    path
        |> String.split "/"
        |> List.filter ((/=) "")
        |> List.map Url.percentDecode
        |> List.foldr (Maybe.map2 (::)) (Just [])


encodePath : String -> String
encodePath path =
    path
        |> String.split "/"
        |> List.map Url.percentEncode
        |> String.join "/"


maybeToList : Maybe a -> List a
maybeToList maybe =
    case maybe of
        Just value ->
            [ value ]

        Nothing ->
            []


type alias QueryOptions =
    { search : Search
    , pullState : PullRequestState
    , file : Maybe String
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
                                Maybe.map2 Tuple.pair
                                    (Url.percentDecode (String.replace "+" " " key))
                                    (Url.percentDecode (String.replace "+" " " (String.join "=" valueParts)))

                            [] ->
                                Nothing
                    )

        find key =
            pairs
                |> List.filter (Tuple.first >> (==) key)
                |> List.head
                |> Maybe.map Tuple.second
                |> Maybe.andThen nonEmpty
    in
    { search =
        case find "q" of
            Just text ->
                Search text
                    (find "search"
                        |> Maybe.andThen Repository.searchModeFromString
                        |> Maybe.withDefault LiteralSearch
                    )

            Nothing ->
                NoSearch
    , pullState =
        find "state"
            |> Maybe.andThen Repository.pullRequestStateFromString
            |> Maybe.withDefault OpenPulls
    , file = find "file"
    }


nonEmpty : String -> Maybe String
nonEmpty value =
    if value == "" then
        Nothing

    else
        Just value
