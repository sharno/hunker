module Hunker.Page.Home exposing (Model, Msg(..), init, update, view)

import Html exposing (Html, a, button, div, h1, header, input, main_, p, section, span, text)
import Html.Attributes exposing (class, href, placeholder, type_, value)
import Html.Events exposing (onClick, onInput)
import Hunker.Api as Api
import Hunker.ApiError as ApiError exposing (ApiError)
import Hunker.Domain.Git as Git
import Hunker.Domain.Repository exposing (Repository, RepositoryCatalog, RepositoryRoot(..))
import Hunker.Effect as Effect exposing (Effect)
import Hunker.Route as Route


type alias Model =
    { repositories : Catalog
    , query : String
    }


type Catalog
    = Listing
    | ListFailed ApiError
    | Listed RepositoryCatalog


type Msg
    = ChangedQuery String
    | Loaded RepositoryCatalog
    | Failed ApiError
    | Retried


init : ( Model, Effect Msg )
init =
    ( { repositories = Listing, query = "" }, Api.listRepositories Loaded Failed )


update : Msg -> Model -> ( Model, Effect Msg )
update msg model =
    case msg of
        ChangedQuery query ->
            ( { model | query = query }, Effect.none )

        Loaded catalog ->
            ( { model | repositories = Listed catalog }, Effect.none )

        Failed error ->
            ( { model | repositories = ListFailed error }, Effect.none )

        Retried ->
            ( { model | repositories = Listing }, Api.listRepositories Loaded Failed )


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
        Listing ->
            stateView "Reading local repositories…" "Looking below your configured and temporary repository roots."

        ListFailed error ->
            section [ class "page-state is-error", Html.Attributes.attribute "role" "alert" ]
                [ h1 [] [ text "Could not list repositories" ]
                , p [] [ text (ApiError.message error) ]
                , button [ type_ "button", onClick Retried ] [ text "Try again" ]
                ]

        Listed catalog ->
            let
                ( configured, temporary ) =
                    catalog.repositories
                        |> List.filter (matches model.query)
                        |> List.partition (.source >> (==) Configured)
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
        , href
            (Route.toPath
                (Route.Repository
                    { repository = Git.repositoryId repository.owner repository.name
                    , view = Route.FilesView { ref = Nothing, file = Nothing, search = Route.NoSearch }
                    }
                )
            )
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
