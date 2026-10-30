module Hunker.Route exposing
    ( FilesLocation
    , GithubInputError(..)
    , OpenFile
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
    , sameScreen
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
    , file : Maybe OpenFile
    , search : Search
    }


{-| An open repository file, optionally at one line (GitHub's `#L42`).
-}
type alias OpenFile =
    { path : String
    , line : Maybe Int
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
    case decodedSegments url.path of
        Nothing ->
            NotFound url.path

        Just segments ->
            parseSegments segments (queryOptions url.query url.fragment)
                |> Maybe.withDefault (NotFound url.path)


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
                case fromUrl url of
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


parseSegments : List String -> QueryOptions -> Maybe Route
parseSegments segments options =
    let
        repository owner name view =
            Just (Repository { repository = Git.repositoryId owner name, view = view })

        review owner name subject =
            Just (Review { repository = Git.repositoryId owner name, subject = subject })

        files ref path =
            FilesView { ref = ref, file = Maybe.map (\filePath -> { path = filePath, line = options.line }) path, search = options.search }
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
            case ( files.file, files.ref ) of
                ( Just file, reference ) ->
                    prefix
                        ++ "/blob/"
                        ++ Url.percentEncode (Maybe.withDefault "HEAD" reference)
                        ++ "/"
                        ++ encodePath file.path
                        ++ Url.Builder.toQuery (searchQuery files.search)
                        ++ (file.line |> Maybe.map (\line -> "#L" ++ String.fromInt line) |> Maybe.withDefault "")

                ( Nothing, Just reference ) ->
                    prefix ++ "/tree/" ++ Url.percentEncode reference ++ Url.Builder.toQuery (searchQuery files.search)

                ( Nothing, Nothing ) ->
                    prefix ++ Url.Builder.toQuery (searchQuery files.search)

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


{-| Whether two routes show the same screen. Selecting another file of one
review diff stays on its screen; any other move is a new screen, which starts
at the top as a page load would.
-}
sameScreen : Route -> Route -> Bool
sameScreen first second =
    screen first == screen second


screen : Route -> Route
screen route =
    case route of
        Review location ->
            Review (deselect location)

        Repository _ ->
            route

        Home ->
            route

        Settings ->
            route

        NotFound _ ->
            route


deselect : ReviewLocation -> ReviewLocation
deselect location =
    { location
        | subject =
            case location.subject of
                PullRequest number (PullFiles _) ->
                    PullRequest number (PullFiles Nothing)

                PullRequest number PullCommits ->
                    PullRequest number PullCommits

                PullRequest number (PullCommitFiles sha _) ->
                    PullRequest number (PullCommitFiles sha Nothing)

                Compare range _ ->
                    Compare range Nothing

                Commit sha _ ->
                    Commit sha Nothing
    }


{-| The pull request whose own head this location shows. A commit selected
inside a pull request is pinned on purpose: it has no live head, review
threads, or composer.
-}
pullRequest : ReviewLocation -> Maybe PullRequestRef
pullRequest location =
    case location.subject of
        PullRequest number (PullFiles _) ->
            Just { repository = location.repository, number = number }

        PullRequest number PullCommits ->
            Just { repository = location.repository, number = number }

        PullRequest _ (PullCommitFiles _ _) ->
            Nothing

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
    , line : Maybe Int
    }


queryOptions : Maybe String -> Maybe String -> QueryOptions
queryOptions query fragment =
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
    , line = Maybe.andThen lineFragment fragment
    }


{-| GitHub's `#L42` and `#L42-L50` both name line 42.
-}
lineFragment : String -> Maybe Int
lineFragment fragment =
    if String.startsWith "L" fragment then
        String.dropLeft 1 fragment
            |> String.split "-"
            |> List.head
            |> Maybe.andThen String.toInt

    else
        Nothing


nonEmpty : String -> Maybe String
nonEmpty value =
    if value == "" then
        Nothing

    else
        Just value
