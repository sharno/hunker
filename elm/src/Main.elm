module Main exposing (Model, Msg(..), init, main, update, view)

import Browser
import Browser.Navigation as Navigation
import Html exposing (Html, a, button, div, form, header, input, main_, p, span, strong, text)
import Html.Attributes exposing (attribute, class, href, placeholder, type_, value)
import Html.Events exposing (onInput, onSubmit)
import Hunker.Api as Api
import Hunker.Domain.Settings as Settings exposing (Settings, SettingsDocument)
import Hunker.Effect as Effect exposing (Effect)
import Hunker.Page.Home as Home
import Hunker.Page.Repository as Repository
import Hunker.Page.Review as Review
import Hunker.Page.Settings as SettingsPage
import Hunker.Route as Route exposing (Route)
import Url exposing (Url)


type AppState
    = Booting Route
    | BootFailed Route String
    | Ready Settings Page


type Page
    = HomePage Home.Model
    | SettingsPage SettingsPage.Model
    | RepositoryPage Repository.Model
    | ReviewPage Review.Model
    | NotFoundPage String


type alias Model =
    { route : Route
    , state : AppState
    , githubInput : String
    , githubInputError : String
    }


type alias RuntimeModel =
    { key : Navigation.Key
    , app : Model
    }


type Msg
    = LinkClicked Browser.UrlRequest
    | UrlChanged Url
    | SettingsLoaded SettingsDocument
    | SettingsFailed String
    | RetriedBootstrap
    | ChangedGitHubInput String
    | SubmittedGitHubInput
    | HomeMsg Home.Msg
    | SettingsMsg SettingsPage.Msg
    | RepositoryMsg Repository.Msg
    | ReviewMsg Review.Msg


main : Program () RuntimeModel Msg
main =
    Browser.application
        { init = runtimeInit
        , onUrlChange = UrlChanged
        , onUrlRequest = LinkClicked
        , subscriptions = .app >> subscriptions
        , update = runtimeUpdate
        , view = .app >> view
        }


init : () -> Url -> ignoredKey -> ( Model, Effect Msg )
init _ url _ =
    let
        route =
            Route.fromUrl url
    in
    ( { route = route
      , state = Booting route
      , githubInput = ""
      , githubInputError = ""
      }
    , Api.loadSettings SettingsLoaded SettingsFailed
    )


runtimeInit : () -> Url -> Navigation.Key -> ( RuntimeModel, Cmd Msg )
runtimeInit flags url key =
    let
        ( app, effect ) =
            init flags url ()
    in
    ( { key = key, app = app }, Effect.perform key effect )


runtimeUpdate : Msg -> RuntimeModel -> ( RuntimeModel, Cmd Msg )
runtimeUpdate msg runtime =
    let
        ( app, effect ) =
            update msg runtime.app
    in
    ( { runtime | app = app }, Effect.perform runtime.key effect )


subscriptions : Model -> Sub Msg
subscriptions model =
    case model.state of
        Ready _ page ->
            case page of
                RepositoryPage repository ->
                    Sub.map RepositoryMsg (Repository.subscriptions repository)

                ReviewPage review ->
                    Sub.map ReviewMsg (Review.subscriptions review)

                _ ->
                    Sub.none

        _ ->
            Sub.none


update : Msg -> Model -> ( Model, Effect Msg )
update msg model =
    case msg of
        LinkClicked request ->
            case request of
                Browser.Internal url ->
                    ( model, Effect.PushUrl (Url.toString url) )

                Browser.External url ->
                    ( model, Effect.LoadExternal url )

        UrlChanged url ->
            let
                route =
                    Route.fromUrl url
            in
            case model.state of
                Ready settings (ReviewPage review) ->
                    case route of
                        Route.Review reviewLocation ->
                            let
                                ( updated, effect ) =
                                    Review.navigate reviewLocation review
                            in
                            ( { model | route = route, state = Ready updated.settings (ReviewPage updated) }
                            , Effect.map ReviewMsg effect
                            )

                        _ ->
                            startRoute settings route { model | route = route }

                Ready settings _ ->
                    startRoute settings route { model | route = route }

                BootFailed _ error ->
                    ( { model | route = route, state = BootFailed route error }, Effect.none )

                Booting _ ->
                    ( { model | route = route, state = Booting route }, Effect.none )

        SettingsLoaded document ->
            startRoute document.settings model.route model

        SettingsFailed error ->
            ( { model | state = BootFailed model.route error }, Effect.none )

        RetriedBootstrap ->
            ( { model | state = Booting model.route }, Api.loadSettings SettingsLoaded SettingsFailed )

        ChangedGitHubInput githubInput ->
            ( { model | githubInput = githubInput, githubInputError = "" }, Effect.none )

        SubmittedGitHubInput ->
            case Route.fromGithubString (String.trim model.githubInput) of
                Ok route ->
                    ( { model | githubInputError = "" }, Effect.PushUrl (Route.toPath route) )

                Err error ->
                    ( { model | githubInputError = error }, Effect.none )

        HomeMsg message ->
            updatePage model
                (\settings page ->
                    case page of
                        HomePage home ->
                            Home.update message home
                                |> mapPage HomePage HomeMsg settings model

                        _ ->
                            unchanged model
                )

        SettingsMsg message ->
            updatePage model
                (\settings page ->
                    case page of
                        SettingsPage settingsModel ->
                            let
                                ( updated, effect ) =
                                    SettingsPage.update message settingsModel
                            in
                            ( { model | state = Ready updated.draft (SettingsPage updated) }
                            , Effect.map SettingsMsg effect
                            )

                        _ ->
                            unchanged model
                )

        RepositoryMsg message ->
            updatePage model
                (\settings page ->
                    case page of
                        RepositoryPage repository ->
                            Repository.update message repository
                                |> mapPage RepositoryPage RepositoryMsg settings model

                        _ ->
                            unchanged model
                )

        ReviewMsg message ->
            updatePage model
                (\settings page ->
                    case page of
                        ReviewPage review ->
                            let
                                ( updated, effect ) =
                                    Review.update message review
                            in
                            ( { model | state = Ready updated.settings (ReviewPage updated) }
                            , Effect.map ReviewMsg effect
                            )

                        _ ->
                            unchanged model
                )


updatePage : Model -> (Settings -> Page -> ( Model, Effect Msg )) -> ( Model, Effect Msg )
updatePage model apply =
    case model.state of
        Ready settings page ->
            apply settings page

        _ ->
            unchanged model


mapPage : (childModel -> Page) -> (childMsg -> Msg) -> Settings -> Model -> ( childModel, Effect childMsg ) -> ( Model, Effect Msg )
mapPage toPage toMsg settings model ( childModel, childEffect ) =
    ( { model | state = Ready settings (toPage childModel) }
    , Effect.map toMsg childEffect
    )


startRoute : Settings -> Route -> Model -> ( Model, Effect Msg )
startRoute settings route model =
    case route of
        Route.Home ->
            let
                ( home, effect ) =
                    Home.init
            in
            ( { model | route = route, state = Ready settings (HomePage home) }
            , Effect.map HomeMsg effect
            )

        Route.Settings ->
            let
                ( settingsModel, effect ) =
                    SettingsPage.init settings
            in
            ( { model | route = route, state = Ready settings (SettingsPage settingsModel) }
            , Effect.map SettingsMsg effect
            )

        Route.Repository repositoryLocation ->
            let
                ( repository, effect ) =
                    Repository.init repositoryLocation
            in
            ( { model | route = route, state = Ready settings (RepositoryPage repository) }
            , Effect.map RepositoryMsg effect
            )

        Route.Review reviewLocation ->
            let
                ( review, effect ) =
                    Review.init settings reviewLocation
            in
            ( { model | route = route, state = Ready settings (ReviewPage review) }
            , Effect.map ReviewMsg effect
            )

        Route.NotFound path ->
            ( { model | route = route, state = Ready settings (NotFoundPage path) }, Effect.none )


view : Model -> Browser.Document Msg
view model =
    { title = documentTitle model
    , body =
        [ div [ class "hunker-app" ]
            [ topBar model
            , pageView model
            ]
        ]
    }


documentTitle : Model -> String
documentTitle model =
    case model.state of
        Ready _ (ReviewPage review) ->
            Review.title review

        Ready _ (RepositoryPage repository) ->
            Repository.repositoryName repository ++ " · Hunker"

        Ready _ (SettingsPage _) ->
            "Settings · Hunker"

        Ready _ (HomePage _) ->
            "Local repositories · Hunker"

        Ready _ (NotFoundPage _) ->
            "Not found · Hunker"

        BootFailed _ _ ->
            "Could not start · Hunker"

        Booting _ ->
            "Loading · Hunker"


topBar : Model -> Html Msg
topBar model =
    header [ class "app-bar" ]
        [ a [ class "brand", href "/" ]
            [ span [ class "brand-mark" ] [ text "H" ]
            , span [ class "brand-name" ] [ text "hunker" ]
            ]
        , pageToolbar model
        , form [ class "github-location-form", onSubmit SubmittedGitHubInput ]
            [ input
                [ type_ "text"
                , attribute "aria-label" "GitHub URL"
                , placeholder "Paste any GitHub URL"
                , value model.githubInput
                , onInput ChangedGitHubInput
                , attribute "aria-invalid"
                    (if model.githubInputError == "" then
                        "false"

                     else
                        "true"
                    )
                ]
                []
            , button [ type_ "submit" ] [ text "Open" ]
            , if model.githubInputError == "" then
                text ""

              else
                span [ class "github-location-error", attribute "role" "alert" ] [ text model.githubInputError ]
            ]
        , a [ class "app-bar-button", href "/settings" ] [ text "Settings" ]
        ]


pageToolbar : Model -> Html Msg
pageToolbar model =
    case model.state of
        Ready _ (RepositoryPage repository) ->
            div [ class "repository-toolbar" ]
                (Repository.toolbar repository |> List.map (Html.map RepositoryMsg))

        Ready _ (ReviewPage review) ->
            div [ class "review-app-location" ]
                [ span [] [ text "Review" ]
                , strong [] [ text (Route.repositoryName review.location.target) ]
                ]

        _ ->
            span [ class "brand-tagline" ] [ text "review the change, not the noise" ]


pageView : Model -> Html Msg
pageView model =
    case model.state of
        Booting _ ->
            stateView "Starting Hunker…" "Loading server-owned settings before choosing the page state."

        BootFailed _ error ->
            main_ [ class "page-state is-error", attribute "role" "alert" ]
                [ strong [] [ text "Could not load Hunker settings" ]
                , p [] [ text error ]
                , button [ type_ "button", Html.Events.onClick RetriedBootstrap ] [ text "Try again" ]
                ]

        Ready settings page ->
            case page of
                HomePage home ->
                    Html.map HomeMsg (Home.view home)

                SettingsPage settingsModel ->
                    Html.map SettingsMsg (SettingsPage.view settingsModel)

                RepositoryPage repository ->
                    Html.map RepositoryMsg (Repository.view settings.syntaxHighlighting repository)

                ReviewPage review ->
                    Html.map ReviewMsg (Review.view review)

                NotFoundPage path ->
                    main_ [ class "page-state is-error" ]
                        [ strong [] [ text "Hunker does not have a view for this URL" ]
                        , p [] [ text path ]
                        , a [ href "/" ] [ text "Return to repositories" ]
                        ]


stateView : String -> String -> Html msg
stateView heading detail =
    main_ [ class "page-state" ]
        [ span [ class "loading-spinner" ] []
        , strong [] [ text heading ]
        , p [] [ text detail ]
        ]


unchanged : Model -> ( Model, Effect Msg )
unchanged model =
    ( model, Effect.none )
