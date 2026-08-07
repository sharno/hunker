module Hunker.Page.Home exposing (Model, Msg(..), init, update, view)

import Html exposing (Html, a, div, h1, header, input, main_, p, section, span, text)
import Html.Attributes exposing (class, href, placeholder, type_, value)
import Html.Events exposing (onInput)
import Hunker.Api as Api
import Hunker.Domain.Repository exposing (Repository, RepositoryCatalog)
import Hunker.Effect exposing (Effect)
import Hunker.Remote as Remote exposing (Remote(..))
import Url


type alias Model =
    { repositories : Remote () String RepositoryCatalog
    , query : String
    }


type Msg
    = ChangedQuery String
    | Loaded RepositoryCatalog
    | Failed String


init : ( Model, Effect Msg )
init =
    ( { repositories = Loading (), query = "" }
    , Api.listRepositories Loaded Failed
    )


update : Msg -> Model -> ( Model, Effect Msg )
update msg model =
    case msg of
        ChangedQuery query ->
            ( { model | query = query }, Hunker.Effect.none )

        Loaded catalog ->
            ( { model | repositories = Success () catalog }, Hunker.Effect.none )

        Failed error ->
            ( { model | repositories = Failure () error }, Hunker.Effect.none )


view : Model -> Html Msg
view model =
    main_ [ class "home-page" ]
        [ header [ class "home-heading" ]
            [ div []
                [ span [ class "eyebrow" ] [ text "Local workspace" ]
                , h1 [] [ text "Repositories" ]
                , p [] [ text "Browse configured checkouts and Hunker’s temporary shallow clones." ]
                ]
            , input
                [ type_ "search"
                , Html.Attributes.attribute "aria-label" "Filter repositories"
                , placeholder "Filter repositories"
                , value model.query
                , onInput ChangedQuery
                ]
                []
            ]
        , repositoriesView model
        ]


repositoriesView : Model -> Html Msg
repositoriesView model =
    case model.repositories of
        NotAsked ->
            text ""

        Loading _ ->
            stateView "Reading local repositories…" "Looking below your configured and temporary repository roots."

        Failure _ error ->
            section [ class "page-state is-error", Html.Attributes.attribute "role" "alert" ]
                [ h1 [] [ text "Could not list repositories" ], p [] [ text error ] ]

        Success _ catalog ->
            let
                matching =
                    catalog.repositories
                        |> List.filter (matches model.query)

                configured =
                    List.filter (.source >> (==) "configured") matching

                temporary =
                    List.filter (.source >> (==) "temporary") matching
            in
            div [ class "repository-catalog" ]
                [ repositoryGroup "Repos root" catalog.configuredRoot configured
                , repositoryGroup "Temporary clones" catalog.temporaryRoot temporary
                ]


stateView : String -> String -> Html Msg
stateView title detail =
    section [ class "page-state" ]
        [ span [ class "loading-spinner" ] []
        , h1 [] [ text title ]
        , p [] [ text detail ]
        ]


repositoryGroup : String -> String -> List Repository -> Html Msg
repositoryGroup title root repositories =
    section [ class "repository-group" ]
        [ header []
            [ div [] [ h1 [] [ text title ], p [] [ text root ] ]
            , span [ class "count-badge" ] [ text (String.fromInt (List.length repositories)) ]
            ]
        , if List.isEmpty repositories then
            p [ class "empty-copy" ] [ text "No matching repositories in this root." ]

          else
            div [ class "repository-cards" ] (List.map repositoryCard repositories)
        ]


repositoryCard : Repository -> Html Msg
repositoryCard repository =
    a
        [ class "repository-card"
        , href ("/" ++ Url.percentEncode repository.owner ++ "/" ++ Url.percentEncode repository.name)
        ]
        [ span [ class "repository-card-icon" ] [ text "git" ]
        , span [ class "repository-card-copy" ]
            [ strongText (repository.owner ++ "/" ++ repository.name)
            , span [] [ text repository.path ]
            ]
        , span [ class "repository-card-arrow" ] [ text "→" ]
        ]


strongText : String -> Html msg
strongText value =
    Html.strong [] [ text value ]


matches : String -> Repository -> Bool
matches query repository =
    let
        needle =
            String.toLower (String.trim query)
    in
    needle
        == ""
        || String.contains needle (String.toLower (repository.owner ++ "/" ++ repository.name))
        || String.contains needle (String.toLower repository.path)
